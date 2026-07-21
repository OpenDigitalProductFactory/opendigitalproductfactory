import { describe, it, expect } from "vitest";
import { ALL_ARCHETYPES } from "./archetypes/index";
import { deriveTwinProfile, type TwinTemplate } from "./twin-profile";
import type { ArchetypeDefinition } from "./types";
import { deriveFieldDispatchProfile } from "./field-dispatch";
import { readActivationProfile } from "./activation-profile";

const ALL_TEMPLATES: TwinTemplate[] = [
  "DOCK",
  "FLOOR",
  "TERRITORY",
  "YARD",
  "BAYS",
  "BOOK",
  "ROOMS",
  "STORE",
  "VENUE",
  "COUNTER",
  "TENANTS",
  "PIPELINE",
  "PROGRAMS",
];
const BOARD_TEMPLATES: TwinTemplate[] = ["TENANTS", "PIPELINE", "PROGRAMS"];
const NON_PHYSICAL_CATEGORIES = new Set([
  "software-platform",
  "banking-financial-services",
  "professional-services",
  "media-production",
  "nonprofit-community",
]);

const byCategory = (category: string): ArchetypeDefinition[] =>
  ALL_ARCHETYPES.filter((a) => a.category === category);

/** Whether an archetype's own axes make it physically dispatch-native or a
 *  reservation-and-return rental pool — the two ways a "non-physical" *category*
 *  legitimately earns a physical twin (a land-surveyor prof-svcs firm dispatches;
 *  an equipment co-op pools assets). Category is not destiny; axes win. */
function isPhysicalByAxes(a: ArchetypeDefinition): boolean {
  const axes = readActivationProfile(a.activationProfile)?.axes;
  if (!axes) return a.fieldDispatch?.enabled === true;
  if (axes.provisioning === "reservation-and-return") return true;
  if (a.fieldDispatch?.enabled === true) return true;
  if (a.fieldDispatch?.enabled === false) return false;
  return deriveFieldDispatchProfile(axes, a.archetypeId, a.fieldDispatch) !== null;
}

describe("deriveTwinProfile — totality", () => {
  it("returns a valid, complete twin for EVERY seeded archetype", () => {
    for (const a of ALL_ARCHETYPES) {
      const twin = deriveTwinProfile(a);
      expect(ALL_TEMPLATES, `${a.archetypeId} → unknown template`).toContain(twin.template);
      expect(twin.zones.length, `${a.archetypeId} needs zones`).toBeGreaterThan(0);
      expect(twin.queues.length, `${a.archetypeId} needs a queue`).toBeGreaterThan(0);
      expect(twin.capacityChips.length, `${a.archetypeId} needs capacity chips`).toBeGreaterThan(0);
      expect(twin.resourceNoun.singular, `${a.archetypeId} resource noun`).toBeTruthy();
      expect(twin.resourceNoun.plural, `${a.archetypeId} resource plural`).toBeTruthy();
      expect(twin.workItemNoun.singular, `${a.archetypeId} work-item noun`).toBeTruthy();
      expect(twin.cog.kind, `${a.archetypeId} needs a cog`).toBeTruthy();
      expect(twin.cog.signals.length, `${a.archetypeId} cog needs signals`).toBeGreaterThan(0);
      expect(typeof twin.physical).toBe("boolean");
      // capacityZoneKey must name a real zone — consumers render resource units
      // into that region, so a dangling key would drop the whole capacity view.
      expect(
        twin.zones.map((zn) => zn.key),
        `${a.archetypeId} capacityZoneKey must be one of its zones`,
      ).toContain(twin.capacityZoneKey);
    }
  });

  it("is deterministic (same archetype → same profile)", () => {
    for (const a of ALL_ARCHETYPES) {
      expect(deriveTwinProfile(a)).toEqual(deriveTwinProfile(a));
    }
  });

  it("physical flag exactly matches the template class for every archetype", () => {
    for (const a of ALL_ARCHETYPES) {
      const twin = deriveTwinProfile(a);
      expect(twin.physical, `${a.archetypeId}`).toBe(!BOARD_TEMPLATES.includes(twin.template));
    }
  });
});

describe("deriveTwinProfile — physical vs non-physical taxonomy (axes win over category)", () => {
  it("desk-bound work in a non-physical category → a board; field/rental work in the same category → a physical twin", () => {
    for (const category of NON_PHYSICAL_CATEGORIES) {
      for (const a of byCategory(category)) {
        const twin = deriveTwinProfile(a);
        if (isPhysicalByAxes(a)) {
          // e.g. land-surveying (professional-services) or an equipment co-op (nonprofit) —
          // legitimately physical; category does not force a board.
          expect(twin.physical, `${a.archetypeId} is physical by axes`).toBe(true);
        } else {
          expect(BOARD_TEMPLATES, `${a.archetypeId} (${category}) should be a board`).toContain(twin.template);
          expect(twin.physical).toBe(false);
        }
      }
    }
  });

  it("every seeded software-platform archetype is the TENANTS board", () => {
    const saas = byCategory("software-platform");
    expect(saas.length).toBeGreaterThan(0);
    for (const a of saas) expect(deriveTwinProfile(a).template).toBe("TENANTS");
  });
});

describe("deriveTwinProfile — signature mappings", () => {
  it("routes dispatch-native archetypes to TERRITORY with the field-dispatch resource noun", () => {
    for (const a of ALL_ARCHETYPES) {
      const axes = readActivationProfile(a.activationProfile)?.axes;
      if (!axes || a.fieldDispatch?.enabled === false) continue;
      const fd = deriveFieldDispatchProfile(axes, a.archetypeId, a.fieldDispatch);
      if (fd) {
        const twin = deriveTwinProfile(a);
        expect(twin.template, `${a.archetypeId} is dispatch-native`).toBe("TERRITORY");
        expect(twin.resourceNoun.singular, `${a.archetypeId} binds the FD resource`).toBe(fd.resource.noun);
      }
    }
  });

  it("routes rental (asset-rental) to YARD with a forward horizon", () => {
    for (const a of byCategory("asset-rental")) {
      const twin = deriveTwinProfile(a);
      expect(twin.template).toBe("YARD");
      expect(twin.forwardHorizon).toBe(true);
    }
  });

  it("maps the clearly-determined categories to their template + variant", () => {
    const expectAll = (category: string, pred: (t: ReturnType<typeof deriveTwinProfile>) => boolean) => {
      const list = byCategory(category);
      for (const a of list) expect(pred(deriveTwinProfile(a)), `${a.archetypeId}`).toBe(true);
    };
    expectAll("banking-financial-services", (t) => t.template === "TENANTS" && t.variant === "portfolio");
    expectAll("media-production", (t) => t.template === "PIPELINE" && t.variant === "timeline");
    expectAll("food-hospitality", (t) => t.template === "FLOOR");
    expectAll("retail-goods", (t) => t.template === "STORE" || t.template === "TERRITORY");
    expectAll("hoa-property-management", (t) => t.template === "TERRITORY" && t.variant === "unit-portfolio");
    expectAll("real-estate-construction", (t) => t.template === "TERRITORY" && t.variant === "job-sites");
    expectAll("live-events-venues", (t) => t.template === "VENUE");
  });
});

describe("deriveTwinProfile — leaf override (ADR-4 escape hatch)", () => {
  it("lets a leaf override the template, variant, and nouns; unspecified nouns fall through", () => {
    const base = byCategory("food-hospitality")[0] ?? ALL_ARCHETYPES[0];
    const overridden: ArchetypeDefinition = {
      ...base,
      twinProfile: {
        template: "STORE",
        resourceNoun: { singular: "counter" },
        cog: { kind: "restock-and-pick" },
      },
    };
    const twin = deriveTwinProfile(overridden);
    expect(twin.template).toBe("STORE");
    expect(twin.resourceNoun.singular).toBe("counter");
    expect(twin.resourceNoun.plural).toBeTruthy(); // plural falls through from the STORE default
    expect(twin.cog.kind).toBe("restock-and-pick");
  });
});

describe("deriveTwinProfile — coverage breadth", () => {
  it("the seeded catalog exercises a broad set of templates (>= 8 of 12)", () => {
    const seen = new Set(ALL_ARCHETYPES.map((a) => deriveTwinProfile(a).template));
    expect(seen.size).toBeGreaterThanOrEqual(8);
  });

  it("produces both physical twins and board twins across the catalog", () => {
    const templates = ALL_ARCHETYPES.map((a) => deriveTwinProfile(a).template);
    expect(templates.some((t) => !BOARD_TEMPLATES.includes(t))).toBe(true);
    expect(templates.some((t) => BOARD_TEMPLATES.includes(t))).toBe(true);
  });
});
