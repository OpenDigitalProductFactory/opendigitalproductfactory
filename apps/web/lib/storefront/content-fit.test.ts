import { describe, it, expect } from "vitest";
import {
  classifyStorefrontContentFit,
  sectionDisplayName,
  friendlySectionTypeLabel,
  type ContentFitFingerprint,
  type FitItem,
  type FitSection,
} from "./content-fit";
import { getVocabulary } from "./archetype-vocabulary";

const FINGERPRINT: ContentFitFingerprint = {
  itemNameCategories: {
    "pallet storage": ["warehousing-fulfilment"],
    "goods-in & receiving": ["warehousing-fulfilment"],
    "set dinner menu": ["food-hospitality"],
    // A name legitimately shared by both restaurant and warehousing seeds.
    "gift cards": ["food-hospitality", "retail-goods"],
  },
  categoryLabels: {
    "warehousing-fulfilment": "Warehousing Fulfilment",
    "food-hospitality": "Food Hospitality",
  },
};

const restaurantVocab = getVocabulary("food-hospitality");

function section(partial: Partial<FitSection> & { id: string; type: string }): FitSection {
  return { title: null, isVisible: true, sortOrder: 0, ...partial };
}

describe("classifyStorefrontContentFit", () => {
  it("flags foreign item-template names but never owner-typed or shared names", () => {
    const items: FitItem[] = [
      { id: "i1", name: "Set Dinner Menu", category: "Set Menus", isActive: true }, // native
      { id: "i2", name: "Pallet Storage", category: null, isActive: true }, // foreign
      { id: "i3", name: "Goods-In & Receiving", category: null, isActive: false }, // foreign, hidden
      { id: "i4", name: "Table for 2", category: null, isActive: true }, // owner-authored, unknown
      { id: "i5", name: "Gift Cards", category: null, isActive: true }, // shared with current → keep
    ];
    const result = classifyStorefrontContentFit({
      currentCategory: "food-hospitality",
      items,
      sections: [],
      fingerprint: FINGERPRINT,
      vocabulary: restaurantVocab,
    });

    const ids = result.residueItems.map((r) => r.id).sort();
    expect(ids).toEqual(["i2", "i3"]);
    expect(result.residueItems[0]?.foreignLabel).toBe("Warehousing Fulfilment");
    expect(result.hasResidue).toBe(true);
  });

  it("flags archetype-specific foreign sections and duplicate singletons, not universal ones", () => {
    const sections: FitSection[] = [
      section({ id: "s1", type: "hero", sortOrder: 0 }),
      section({ id: "s2", type: "items", sortOrder: 1 }),
      section({ id: "s3", type: "about", sortOrder: 2 }),
      section({ id: "s4", type: "calculator", sortOrder: 3 }), // foreign (banking)
      section({ id: "s5", type: "hero", sortOrder: 4 }), // duplicate singleton
      section({ id: "s6", type: "custom", title: "Our story", sortOrder: 5 }), // universal, keep
    ];
    const result = classifyStorefrontContentFit({
      currentCategory: "food-hospitality",
      items: [],
      sections,
      fingerprint: FINGERPRINT,
      vocabulary: restaurantVocab,
    });

    const foreign = result.residueSections.find((s) => s.reason === "foreign-archetype");
    const duplicate = result.residueSections.find((s) => s.reason === "duplicate-section");
    expect(foreign?.id).toBe("s4");
    expect(duplicate?.id).toBe("s5"); // the SECOND hero, first is kept
    expect(result.residueSections).toHaveLength(2);
  });

  it("does not flag an archetype-specific section that is native to the current category", () => {
    const sections: FitSection[] = [section({ id: "s1", type: "donate", sortOrder: 0 })];
    const result = classifyStorefrontContentFit({
      currentCategory: "nonprofit-community",
      items: [],
      sections,
      fingerprint: FINGERPRINT,
      vocabulary: getVocabulary("nonprofit-community"),
    });
    expect(result.hasResidue).toBe(false);
  });

  it("groups residue by foreign source and by duplicates for one-action recovery", () => {
    const result = classifyStorefrontContentFit({
      currentCategory: "food-hospitality",
      items: [{ id: "i2", name: "Pallet Storage", category: null, isActive: true }],
      sections: [
        section({ id: "s1", type: "hero", sortOrder: 0 }),
        section({ id: "s5", type: "hero", sortOrder: 1 }),
      ],
      fingerprint: FINGERPRINT,
      vocabulary: restaurantVocab,
    });

    const dup = result.groups.find((g) => g.key === "duplicate-sections");
    const foreign = result.groups.find((g) => g.key.startsWith("category:"));
    expect(dup?.sectionIds).toEqual(["s5"]);
    expect(foreign?.itemIds).toEqual(["i2"]);
    expect(foreign?.count).toBe(1);
  });

  it("returns no residue and no groups for a clean restaurant storefront", () => {
    const result = classifyStorefrontContentFit({
      currentCategory: "food-hospitality",
      items: [{ id: "i1", name: "Set Dinner Menu", category: "Set Menus", isActive: true }],
      sections: [
        section({ id: "s1", type: "hero", sortOrder: 0 }),
        section({ id: "s2", type: "items", sortOrder: 1 }),
      ],
      fingerprint: FINGERPRINT,
      vocabulary: restaurantVocab,
    });
    expect(result.hasResidue).toBe(false);
    expect(result.groups).toHaveLength(0);
  });
});

describe("section display naming (no internal slug leakage)", () => {
  it("prefers the owner's title, else a friendly label — never a raw slug", () => {
    expect(sectionDisplayName({ type: "hero", title: null }, restaurantVocab)).toBe("Welcome banner");
    expect(sectionDisplayName({ type: "items", title: null }, restaurantVocab)).toBe("Menu");
    expect(sectionDisplayName({ type: "animals-available", title: null })).toBe("Adoptable animals");
    expect(sectionDisplayName({ type: "hero", title: "  Welcome to Bella  " }, restaurantVocab)).toBe(
      "Welcome to Bella",
    );
  });

  it("humanises even unknown types rather than exposing the token", () => {
    expect(friendlySectionTypeLabel("weird-new-type")).toBe("Weird New Type");
  });

  it("uses Restaurant vocabulary for menu and staff", () => {
    expect(friendlySectionTypeLabel("items", restaurantVocab)).toBe("Menu");
    expect(friendlySectionTypeLabel("team", restaurantVocab)).toBe("Staff");
  });
});
