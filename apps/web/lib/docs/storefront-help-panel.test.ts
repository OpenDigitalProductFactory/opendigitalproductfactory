import { describe, expect, it } from "vitest";

import {
  resolveStorefrontHelpPanel,
  STOREFRONT_HELP_ROUTE_KEYS,
  type StorefrontHelpPanel,
} from "./storefront-help-panel";
import { getVocabulary } from "@/lib/storefront/archetype-vocabulary";
import { buildContextualDocsHref } from "@/lib/docs-route-map";

// A Restaurant install → food-hospitality vocabulary (Menu / Guests /
// Reservations / Staff), which is what the owner audit sampled.
const RESTAURANT = getVocabulary("food-hospitality");
const opts = { vocab: RESTAURANT, archetypeCategory: "food-hospitality" };

/** All four help questions must be answered (non-empty) for every panel. */
function expectAnswersAllFourQuestions(panel: StorefrontHelpPanel | null): asserts panel is StorefrontHelpPanel {
  expect(panel).not.toBeNull();
  const p = panel!;
  expect(p.whatIsThis.trim().length).toBeGreaterThan(0);
  expect(p.whatToDoNext.length).toBeGreaterThan(0);
  expect(p.whatChangesIfYouSave.length).toBeGreaterThan(0);
  expect(p.howToRecover.length).toBeGreaterThan(0);
  expect(p.title.trim().length).toBeGreaterThan(0);
}

/** Flatten every string in a panel to one lowercase blob for term assertions. */
function panelText(panel: StorefrontHelpPanel): string {
  return [panel.title, panel.whatIsThis, ...panel.whatToDoNext, ...panel.whatChangesIfYouSave, ...panel.howToRecover]
    .join(" ")
    .toLowerCase();
}

describe("resolveStorefrontHelpPanel — route coverage", () => {
  // The six Docs links the acceptance requires route-level coverage for.
  const ROUTES: Array<{ label: string; route: string; docsPath: string }> = [
    { label: "dashboard", route: "/storefront", docsPath: "/docs/storefront/index" },
    { label: "operations", route: "/storefront/settings/operations", docsPath: "/docs/storefront/settings-business-and-operations" },
    { label: "team", route: "/storefront/team", docsPath: "/docs/storefront/team-and-fulfilment" },
    { label: "catalog/items", route: "/storefront/items", docsPath: "/docs/storefront/catalog-and-page-content" },
    { label: "sections", route: "/storefront/sections", docsPath: "/docs/storefront/catalog-and-page-content" },
    { label: "inbox", route: "/storefront/inbox", docsPath: "/docs/storefront/inbox-and-enquiries" },
  ];

  for (const { label, route, docsPath } of ROUTES) {
    it(`resolves a four-question help panel for the ${label} Docs link`, () => {
      const panel = resolveStorefrontHelpPanel(route, opts);
      expectAnswersAllFourQuestions(panel);
      expect(panel.docsPath).toBe(docsPath);
      expect(panel.routeKey).toBe(route);
    });
  }

  it("resolves the same panel for /admin/storefront mirror routes", () => {
    const publicPanel = resolveStorefrontHelpPanel("/storefront/team", opts);
    const adminPanel = resolveStorefrontHelpPanel("/admin/storefront/team", opts);
    expect(adminPanel).not.toBeNull();
    expect(adminPanel!.title).toBe(publicPanel!.title);
    expect(adminPanel!.routeKey).toBe("/storefront/team");
  });

  it("matches leaf routes to their parent panel by longest prefix", () => {
    const leaf = resolveStorefrontHelpPanel("/storefront/team/prov-123", opts);
    expect(leaf).not.toBeNull();
    expect(leaf!.routeKey).toBe("/storefront/team");
  });

  it("resolves /storefront (dashboard) without swallowing more specific routes", () => {
    expect(resolveStorefrontHelpPanel("/storefront", opts)!.routeKey).toBe("/storefront");
    expect(resolveStorefrontHelpPanel("/storefront/settings/operations", opts)!.routeKey).toBe(
      "/storefront/settings/operations",
    );
  });

  it("returns null for non-storefront and malformed routes", () => {
    expect(resolveStorefrontHelpPanel("/finance/reports", opts)).toBeNull();
    expect(resolveStorefrontHelpPanel("/platform/ai", opts)).toBeNull();
    expect(resolveStorefrontHelpPanel("", opts)).toBeNull();
    expect(resolveStorefrontHelpPanel(undefined, opts)).toBeNull();
    expect(resolveStorefrontHelpPanel("storefront/team", opts)).toBeNull();
  });
});

describe("resolveStorefrontHelpPanel — Restaurant vocabulary preservation", () => {
  it("uses Restaurant vocabulary across setup routes: tables, reservations, menu, hours, guests, availability", () => {
    // Aggregate the setup-route panels — the vocabulary must be preserved
    // somewhere across the owner's setup journey, not generic item/customer copy.
    const setupRoutes = [
      "/storefront",
      "/storefront/setup",
      "/storefront/settings/operations",
      "/storefront/team",
      "/storefront/items",
      "/storefront/sections",
      "/storefront/inbox",
    ];
    const blob = setupRoutes
      .map((r) => resolveStorefrontHelpPanel(r, opts))
      .map((p) => {
        expect(p).not.toBeNull();
        return panelText(p!);
      })
      .join(" ");

    for (const term of ["tables", "reservations", "menu", "hours", "guests", "availability"]) {
      expect(blob, `Restaurant vocabulary should include "${term}"`).toContain(term);
    }
    // Generic fallbacks should not leak through when a real archetype is set.
    expect(blob).not.toContain("bookable slot");
  });

  it("operations panel explains what changing hours/timezone affects and how to recover", () => {
    const panel = resolveStorefrontHelpPanel("/storefront/settings/operations", opts)!;
    const changes = panel.whatChangesIfYouSave.join(" ").toLowerCase();
    const recover = panel.howToRecover.join(" ").toLowerCase();
    expect(changes).toContain("hours");
    expect(changes).toContain("time zone");
    expect(recover).toContain("time zone");
    expect(panelText(panel)).toContain("availability");
  });

  it("team panel resolves the table-as-provider / staff confusion", () => {
    const panel = resolveStorefrontHelpPanel("/storefront/team", opts)!;
    const text = panelText(panel);
    expect(text).toContain("tables");
    expect(text).toContain("staff");
    expect(text).toContain("provider");
  });

  it("catalog/items and sections panels give recovery for generated content", () => {
    const items = resolveStorefrontHelpPanel("/storefront/items", opts)!;
    const sections = resolveStorefrontHelpPanel("/storefront/sections", opts)!;
    expect(items.howToRecover.join(" ").toLowerCase()).toContain("delete");
    expect(panelText(items)).toContain("menu");
    expect(sections.howToRecover.join(" ").toLowerCase()).toMatch(/hide|delete/);
    expect(panelText(sections).toLowerCase()).toMatch(/generated|left over|residue/);
  });

  it("inbox panel keeps Reservations/Guests vocabulary", () => {
    const panel = resolveStorefrontHelpPanel("/storefront/inbox", opts)!;
    const text = panelText(panel);
    expect(text).toContain("reservations");
    expect(text).toContain("guests");
  });
});

describe("resolveStorefrontHelpPanel — archetype independence", () => {
  it("adapts vocabulary and resource noun to a non-food archetype", () => {
    const salon = getVocabulary("beauty-personal-care");
    const panel = resolveStorefrontHelpPanel("/storefront/team", {
      vocab: salon,
      archetypeCategory: "beauty-personal-care",
    })!;
    const text = panelText(panel);
    // Salon vocabulary — not Restaurant tables.
    expect(text).toContain("appointment slot");
    expect(text).not.toContain("tables");
  });

  it("falls back to a generic resource noun for an unknown archetype", () => {
    const generic = getVocabulary(null);
    const panel = resolveStorefrontHelpPanel("/storefront/team", { vocab: generic, archetypeCategory: null })!;
    expect(panelText(panel)).toContain("bookable slot");
  });
});

describe("contextual Docs links wire to a help panel", () => {
  it("every storefront help route builds a contextual href whose sourceRoute resolves a panel", () => {
    for (const routeKey of STOREFRONT_HELP_ROUTE_KEYS) {
      const href = buildContextualDocsHref(routeKey);
      expect(href, `${routeKey} should expose a contextual docs link`).not.toBeNull();
      const sourceRoute = new URLSearchParams(href!.split("?")[1]).get("sourceRoute");
      expect(sourceRoute).toBe(routeKey);
      expect(resolveStorefrontHelpPanel(sourceRoute, opts)).not.toBeNull();
    }
  });
});
