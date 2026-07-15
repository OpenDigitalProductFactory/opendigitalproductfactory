import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ALL_ARCHETYPES,
  deriveTwinProfile,
  type ArchetypeDefinition,
  type TwinProfile,
  type TwinTemplate,
} from "@dpf/storefront-templates";

import { buildDemoTwinSnapshot } from "./demo-snapshot";
import { TwinView } from "./TwinView";

// Every one of the 12 templates must render through the single `TwinView`.
// Ten are exercised by a seeded archetype; BAYS and COUNTER have no seeded leaf
// (all automotive / public-sector seeds are field-dispatch / mobile → TERRITORY),
// so they are exercised here via the realistic FIXED-LOCATION config
// (`fieldDispatch.enabled: false`) that `chooseTemplate` routes to them. This
// closes the "template with no seeded leaf is never render-tested" risk noted in
// the framework execution plan.

const BOARD_TEMPLATES = new Set<TwinTemplate>(["TENANTS", "PIPELINE", "PROGRAMS"]);
const ALL_TEMPLATES: TwinTemplate[] = [
  "FLOOR", "TERRITORY", "YARD", "BAYS", "BOOK", "ROOMS",
  "STORE", "VENUE", "COUNTER", "TENANTS", "PIPELINE", "PROGRAMS",
];

function fixedLocation(category: string): ArchetypeDefinition {
  const base = ALL_ARCHETYPES.find((a) => a.category === category);
  if (!base) throw new Error(`no seeded archetype for ${category}`);
  // A fixed-location (non-dispatch) configuration of a category that is seeded
  // only in its mobile form — the legitimate way to reach BAYS/COUNTER.
  return { ...base, fieldDispatch: { enabled: false } };
}

function profileForTemplate(t: TwinTemplate): TwinProfile {
  if (t === "BAYS") return deriveTwinProfile(fixedLocation("automotive-services"));
  if (t === "COUNTER") return deriveTwinProfile(fixedLocation("public-sector"));
  const arch = ALL_ARCHETYPES.find((a) => deriveTwinProfile(a).template === t);
  if (!arch) throw new Error(`no seeded archetype derives ${t}`);
  return deriveTwinProfile(arch);
}

describe("TwinView — all 12 templates render", () => {
  it("renders every template to static markup with its own zones + physical flag", () => {
    for (const t of ALL_TEMPLATES) {
      const profile = profileForTemplate(t);
      expect(profile.template, `${t} profile`).toBe(t);
      const html = renderToStaticMarkup(
        <TwinView profile={profile} snapshot={buildDemoTwinSnapshot(profile)} />,
      );
      const zoneLabel = profile.zones[0]?.label ?? "";
      expect(html, `${t} renders its zone "${zoneLabel}"`).toContain(zoneLabel);
      expect(profile.physical, `${t} physical flag`).toBe(!BOARD_TEMPLATES.has(t));
    }
  });

  it("BAYS + COUNTER (no seeded leaf) render as real physical twins via fixed-location config", () => {
    const bays = profileForTemplate("BAYS");
    expect(bays.template).toBe("BAYS");
    expect(bays.physical).toBe(true);
    const baysHtml = renderToStaticMarkup(
      <TwinView profile={bays} snapshot={buildDemoTwinSnapshot(bays)} />,
    );
    expect(baysHtml).toContain("Bays / lifts");

    const counter = profileForTemplate("COUNTER");
    expect(counter.template).toBe("COUNTER");
    expect(counter.physical).toBe(true);
    const counterHtml = renderToStaticMarkup(
      <TwinView profile={counter} snapshot={buildDemoTwinSnapshot(counter)} />,
    );
    expect(counterHtml).toContain("Service queue");
  });
});
