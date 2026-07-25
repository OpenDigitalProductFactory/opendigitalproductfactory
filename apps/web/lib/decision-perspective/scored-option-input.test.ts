import { describe, expect, it } from "vitest";

import { parseOptionFeatures } from "./scored-option-input";

describe("parseOptionFeatures (BI-6DCF772F)", () => {
  const options = ["ship it", "hold for review"];

  it("returns ok with no scoredOptions when optionFeatures is absent (coverage-only, backward compatible)", () => {
    expect(parseOptionFeatures(options, undefined)).toEqual({ ok: true });
    expect(parseOptionFeatures(options, null)).toEqual({ ok: true });
  });

  it("builds index-aligned DecisionScoredOption[] using the option label as id", () => {
    const result = parseOptionFeatures(options, [
      { speed_to_value: 0.8, blast_radius: 0.2 },
      { speed_to_value: 0.3, blast_radius: 0.1 },
    ]);
    expect(result).toEqual({
      ok: true,
      scoredOptions: [
        { id: "ship it", description: "ship it", features: { speed_to_value: 0.8, blast_radius: 0.2 } },
        { id: "hold for review", description: "hold for review", features: { speed_to_value: 0.3, blast_radius: 0.1 } },
      ],
    });
  });

  it("fails loudly when optionFeatures length does not match options (caller opted into scoring)", () => {
    const result = parseOptionFeatures(options, [{ speed_to_value: 0.8 }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/aligned 1:1 with options \(expected 2\)/);
  });

  it("rejects a non-object option-feature entry", () => {
    const result = parseOptionFeatures(options, [{ speed_to_value: 0.8 }, "nope"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/optionFeatures\[1\] must be an object/);
  });

  it("rejects a non-finite axis value", () => {
    const result = parseOptionFeatures(options, [{ speed_to_value: Number.NaN }, { speed_to_value: 0.3 }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/optionFeatures\[0\]\.speed_to_value must be a finite number/);
  });

  it("rejects an array (not an object) as an entry", () => {
    const result = parseOptionFeatures(options, [[0.8], { speed_to_value: 0.3 }]);
    expect(result.ok).toBe(false);
  });
});
