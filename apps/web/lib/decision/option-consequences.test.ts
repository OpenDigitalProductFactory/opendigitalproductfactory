import { describe, expect, it } from "vitest";

import {
  buildOptionConsequences,
  consequencesByOption,
  parseScoredOptions,
} from "./option-consequences";

describe("parseScoredOptions", () => {
  it("returns nothing for a row that was never scored", () => {
    expect(parseScoredOptions(null)).toEqual([]);
    expect(parseScoredOptions({})).toEqual([]);
    expect(parseScoredOptions([])).toEqual([]);
  });

  it("drops malformed entries instead of guessing at them", () => {
    const parsed = parseScoredOptions([
      { id: "keep", features: { speed_to_value: 0.9 } },
      { description: "no id" },
      "not an object",
      { id: "", features: { speed_to_value: 1 } },
      { id: "no-numeric-features", features: { speed_to_value: "fast" } },
    ]);
    expect(parsed.map((p) => p.id)).toEqual(["keep", "no-numeric-features"]);
    expect(parsed[1]!.features).toBeNull();
  });
});

describe("buildOptionConsequences", () => {
  it("says nothing when fewer than two options carry features", () => {
    expect(
      buildOptionConsequences([{ id: "proceed", features: { speed_to_value: 0.9 } }]),
    ).toEqual([]);
    expect(
      buildOptionConsequences([
        { id: "proceed", features: null },
        { id: "decline", features: null },
      ]),
    ).toEqual([]);
  });

  it("says nothing when the options do not separate", () => {
    const consequences = buildOptionConsequences([
      { id: "proceed", features: { speed_to_value: 0.5, blast_radius: 0.4 } },
      { id: "decline", features: { speed_to_value: 0.5, blast_radius: 0.45 } },
    ]);
    expect(consequences).toEqual([]);
  });

  it("reads a high cost axis as a cost, not a strength", () => {
    const consequences = buildOptionConsequences([
      { id: "proceed", features: { blast_radius: 0.9, speed_to_value: 0.8 } },
      { id: "decline", features: { blast_radius: 0.1, speed_to_value: 0.2 } },
    ]);
    const byOption = consequencesByOption(consequences);
    const proceed = byOption.get("proceed");
    expect(proceed).toBeDefined();
    expect(proceed!.costs.join(" ")).toContain("breaks more if it is wrong");
    expect(proceed!.strengths.join(" ")).toContain("sooner");
    expect(proceed!.costs.join(" ")).not.toContain("sooner");
  });

  it("ignores feature keys that are not real dimensions", () => {
    const consequences = buildOptionConsequences([
      { id: "proceed", features: { made_up_axis: 0.95 } },
      { id: "decline", features: { made_up_axis: 0.05 } },
    ]);
    expect(consequences).toEqual([]);
  });

  it("keeps at most two lines a side, strongest separation first", () => {
    const consequences = buildOptionConsequences([
      {
        id: "proceed",
        features: {
          speed_to_value: 0.9,
          reusability: 0.8,
          evidence_density: 0.75,
          cost_efficiency: 0.7,
        },
      },
      {
        id: "decline",
        features: {
          speed_to_value: 0.1,
          reusability: 0.4,
          evidence_density: 0.5,
          cost_efficiency: 0.6,
        },
      },
    ]);
    const proceed = consequencesByOption(consequences).get("proceed");
    expect(proceed!.strengths).toHaveLength(2);
    expect(proceed!.strengths[0]).toContain("sooner");
  });
});
