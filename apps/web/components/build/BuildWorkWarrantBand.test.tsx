import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { BuildWorkWarrantBand } from "./BuildWorkWarrantBand";
import type { WorkWarrant } from "@/lib/decision/work-warrant";

const baseWarrant: WorkWarrant = {
  altitude: "WWMD",
  altitudeBasis: "structural",
  confidence: "high",
  needsOperatorConfirm: false,
  lane: "governed-interactive",
  budget: {
    modelTier: "strong",
    effortLevel: "high",
    gateProfile: "full",
    tokenCeiling: null,
  },
  evidenceProfile: "architectural",
  reportingProfile: "ledger",
  contextScope: {
    industry: null,
    jurisdiction: null,
    archetype: null,
  },
  reasons: ["touches a cross-cutting platform contract"],
};

describe("BuildWorkWarrantBand", () => {
  it("renders a plain-language architectural warrant summary", () => {
    const html = renderToStaticMarkup(<BuildWorkWarrantBand warrant={baseWarrant} />);

    expect(html).toContain("Work warrant");
    expect(html).toContain("Architecture-level work");
    expect(html).toContain("governed review");
    expect(html).toContain("strong model");
    expect(html).toContain("ledger evidence");
    expect(html).toContain("touches a cross-cutting platform contract");
  });

  it("renders nothing when no warrant has been recorded", () => {
    const html = renderToStaticMarkup(<BuildWorkWarrantBand warrant={null} />);

    expect(html).toBe("");
  });
});
