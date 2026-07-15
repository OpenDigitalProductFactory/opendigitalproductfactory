import { describe, expect, it } from "vitest";
import { detectArchetype } from "../public-web-tools";

describe("detectArchetype", () => {
  it("detects plumber from plumbing keywords", () => {
    expect(detectArchetype("Local plumber for pipe and drain repair")?.id).toBe("plumber");
  });

  it("detects electrician from electrical keywords", () => {
    expect(detectArchetype("Licensed electrician for wiring and circuit installation")?.id).toBe("electrician");
  });

  // BI-85A1E175: Trades/HVAC archetype.
  it("detects HVAC contractor from heating/cooling keywords", () => {
    const m = detectArchetype(
      "HVAC contractor — air conditioning, furnace and heat pump installation, plus ventilation and climate control",
    );
    expect(m?.id).toBe("hvac-contractor");
    expect(m?.confidence).toBeDefined();
  });

  it("does not misroute AC-specific text to plumber", () => {
    // "air conditioning" / "heat pump" belong to HVAC, not plumbing — the plumber
    // block owns boiler/water-heater, so these must not collide.
    expect(detectArchetype("air conditioning and heat pump servicing")?.id).not.toBe("plumber");
  });
});
