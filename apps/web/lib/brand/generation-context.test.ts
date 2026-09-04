import { describe, expect, it } from "vitest";

import { buildBrandGenerationContext } from "./generation-context";
import type { BrandDesignSystem } from "./types";

function system(overrides: Record<string, unknown> = {}): BrandDesignSystem {
  return {
    version: "1.0.0",
    extractedAt: "2026-08-27T00:00:00.000Z",
    sources: [],
    identity: {
      name: "Second Chance Animal Rescue",
      tagline: "Every animal deserves a second chance",
      description: null,
      logo: { darkBg: null, lightBg: null, mark: null },
      voice: { tone: "warm, plain, never guilt-tripping", sampleCopy: [] },
    },
    palette: { primary: "#2f7d5b", secondary: null, accents: [] },
    typography: { families: { sans: "Inter", serif: null, mono: "monospace", display: null } },
    components: {},
    tokens: {},
    confidence: { overall: 0.8, perField: {} },
    gaps: [],
    overrides: {},
    ...overrides,
  } as unknown as BrandDesignSystem;
}

describe("buildBrandGenerationContext (BI-7E7E8635)", () => {
  it("reports an absent brand as absent rather than as an empty one", () => {
    const result = buildBrandGenerationContext(null);

    // An empty brand section reads as "nothing to honour here", which produces
    // exactly the generic output this closes. Null is actionable.
    expect(result.text).toBeNull();
    expect(result.usable).toBe(false);
    expect(result.unknowns).toContain("identity");
  });

  it("renders identity, voice and colour into standing context", () => {
    const result = buildBrandGenerationContext(system());

    expect(result.usable).toBe(true);
    expect(result.text).toContain("Second Chance Animal Rescue");
    expect(result.text).toContain("warm, plain, never guilt-tripping");
    expect(result.text).toContain("#2f7d5b");
  });

  it("names what is not established instead of letting the model invent it", () => {
    const result = buildBrandGenerationContext(system());

    expect(result.unknowns).toContain("imagery.direction");
    expect(result.unknowns).toContain("logo");
    expect(result.unknowns).toContain("avoid");
    expect(result.text).toContain("Ask rather than inventing");
  });

  it("carries do-not rules, which extraction cannot infer", () => {
    const result = buildBrandGenerationContext(
      system({
        identity: {
          ...system().identity,
          avoid: ["cage imagery", "sad-eyes guilt appeals"],
        },
      }),
    );

    expect(result.text).toContain("Never: cage imagery; sad-eyes guilt appeals");
    expect(result.unknowns).not.toContain("avoid");
  });

  it("marks a low-confidence field rather than stating it as fact", () => {
    const result = buildBrandGenerationContext(
      system({ confidence: { overall: 0.4, perField: { "voice.tone": 0.2 } } }),
    );

    expect(result.text).toContain("low confidence");
  });

  it("does not hedge a field the record is confident about", () => {
    const result = buildBrandGenerationContext(
      system({ confidence: { overall: 0.9, perField: { "voice.tone": 0.95 } } }),
    );

    expect(result.text).not.toContain("low confidence");
  });

  it("forbids redrawing the logo when lockups are supplied", () => {
    const result = buildBrandGenerationContext(
      system({
        identity: {
          ...system().identity,
          logo: { darkBg: null, lightBg: { url: "/logo.png", source: "upload" }, mark: null },
        },
      }),
    );

    expect(result.text).toContain("never redraw or re-letter the logo");
    expect(result.unknowns).not.toContain("logo");
  });

  it("honours the record's own declared gaps alongside what it derives", () => {
    const result = buildBrandGenerationContext(system({ gaps: ["secondary-palette"] }));

    expect(result.unknowns).toContain("secondary-palette");
  });
});
