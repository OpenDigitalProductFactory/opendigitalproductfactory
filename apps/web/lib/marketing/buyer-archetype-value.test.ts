import { describe, expect, it, vi } from "vitest";
import { ALL_ARCHETYPES } from "@dpf/storefront-templates";

// draft-builder imports the DB client and the workspace loader; buildDraftVoice
// is pure, so stub the I/O modules rather than standing up a database.
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("../marketing", () => ({ getMarketingWorkspaceSnapshot: vi.fn() }));

import {
  BUYER_ARCHETYPE_VALUE,
  PLATFORM_CLAIM_LIMITS,
  getBuyerArchetypeValue,
  resolveBuyerArchetype,
  sellsThePlatform,
} from "./buyer-archetype-value";
import { buildDraftVoice } from "./draft-builder";
import { buildOwnOfferText } from "./archetype-fit";

describe("buyer-archetype value catalog (BI-B4BE6934)", () => {
  it("covers every archetype category in the catalog — a new category cannot ship without its buyer value", () => {
    const categories = [...new Set(ALL_ARCHETYPES.map((a) => a.category))].sort();
    expect(Object.keys(BUYER_ARCHETYPE_VALUE).sort()).toEqual(categories);
    for (const value of Object.values(BUYER_ARCHETYPE_VALUE)) {
      expect(value.ownerValue.length).toBeGreaterThan(20);
      expect(value.emphasize.length).toBeGreaterThan(10);
    }
  });

  it("resolves the buyer a brief is aimed at from leaf or category words", () => {
    expect(resolveBuyerArchetype("LinkedIn post for HVAC contractors in Texas")?.category).toBe(
      "trades-maintenance",
    );
    expect(resolveBuyerArchetype("Email to dental practice owners")?.category).toBe("healthcare-wellness");
    expect(resolveBuyerArchetype("Campaign for credit union marketing leads")?.category).toBe(
      "banking-financial-services",
    );
    expect(resolveBuyerArchetype("General awareness post")).toBeNull();
    expect(getBuyerArchetypeValue("not-a-category")).toBeNull();
  });

  it("decides 'sells the platform' from the business's own offer, not its identity", () => {
    expect(sellsThePlatform("Open Digital Product Factory — governed AI coworker platform")).toBe(true);
    expect(sellsThePlatform("We resell and support DPF for local firms")).toBe(true);
    expect(sellsThePlatform("Managed IT support and Microsoft 365 setup")).toBe(false);
    expect(sellsThePlatform(null)).toBe(false);
  });
});

describe("buildDraftVoice", () => {
  const strategy = {
    targetSegments: [{ name: "Owner-operated small businesses", description: null }],
    idealCustomerProfiles: [],
  } as never;

  it("keeps a restaurant away from platform language", () => {
    const voice = buildDraftVoice({
      snapshot: {
        storefront: {
          archetypeName: "Restaurant",
          category: "food-hospitality",
          ctaType: "booking",
          ownOffer: buildOwnOfferText({ items: [{ name: "Tasting menu" }] }),
        } as never,
        strategy,
      },
      taskText: "Midweek covers push for HVAC contractors",
    });
    expect(voice.archetypeVoice).toMatch(/NEVER use these terms.*Build Studio/);
    expect(voice.archetypeVoice).not.toContain("Write for this buyer");
    expect(voice.audience).toBe("Owner-operated small businesses");
  });

  it("lets a platform seller name its product and writes to the targeted buyer archetype", () => {
    const voice = buildDraftVoice({
      snapshot: {
        storefront: {
          archetypeName: "Software Platform",
          category: "software-platform",
          ctaType: "inquiry",
          ownOffer: buildOwnOfferText({
            items: [{ name: "Open Digital Product Factory" }, { name: "Governed Build Studio Enablement" }],
            valueProposition: "A governed AI coworker platform for small businesses",
          }),
        } as never,
        strategy,
      },
      taskText: "LinkedIn post: how an HVAC contractor stops losing quote follow-ups",
    });
    expect(voice.audience).toBe(BUYER_ARCHETYPE_VALUE["trades-maintenance"].label);
    expect(voice.archetypeVoice).toContain(BUYER_ARCHETYPE_VALUE["trades-maintenance"].ownerValue);
    expect(voice.archetypeVoice).toContain(PLATFORM_CLAIM_LIMITS);
    expect(voice.archetypeVoice).not.toMatch(/NEVER use these terms[^\n]*Digital Product Factory/);
    expect(voice.archetypeVoice).not.toMatch(/NEVER use these terms[^\n]*Build Studio/);
  });
});
