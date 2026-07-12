import { describe, it, expect } from "vitest";
import { proposeVisualDirections, buildDirectionsPrompt, formatDesignDirections } from "./design-directions";

const threeDirs = JSON.stringify([
  { name: "Calm operator", background: "var(--dpf-bg)", accent: "var(--dpf-accent)", typeface: "Inter / Source Serif", rationale: "low-noise for long sessions" },
  { name: "High contrast", background: "#0b0b0f", accent: "#7c5cff", typeface: "Geist / Geist", rationale: "punchy for a marketing surface" },
  { name: "Warm docs", background: "#fbf7f0", accent: "#b4531f", typeface: "Fraunces / Inter", rationale: "editorial and readable" },
]);

describe("buildDirectionsPrompt", () => {
  it("names the surface, count, and demands a JSON array", () => {
    const p = buildDirectionsPrompt("coworker settings panel", 3);
    expect(p).toContain("coworker settings panel");
    expect(p).toContain("3");
    expect(p).toContain("JSON array");
    expect(p).toContain("DISTINCT");
  });
});

describe("proposeVisualDirections", () => {
  it("parses well-formed directions from the llm", async () => {
    const r = await proposeVisualDirections("panel", { llm: async () => threeDirs });
    expect(r.directions.length).toBe(3);
    expect(r.directions[0].name).toBe("Calm operator");
  });

  it("drops directions missing required fields", async () => {
    const r = await proposeVisualDirections("panel", {
      llm: async () => JSON.stringify([{ name: "ok", background: "#000", accent: "#fff", typeface: "", rationale: "" }, { name: "", background: "#000", accent: "#fff" }]),
    });
    expect(r.directions.length).toBe(1);
  });

  it("clamps count to [2,4]", async () => {
    let captured = "";
    await proposeVisualDirections("panel", { count: 9, llm: async (p) => { captured = p; return "[]"; } });
    expect(captured).toContain("Propose 4");
    await proposeVisualDirections("panel", { count: 1, llm: async (p) => { captured = p; return "[]"; } });
    expect(captured).toContain("Propose 2");
  });

  it("returns empty directions on unparseable llm output", async () => {
    const r = await proposeVisualDirections("panel", { llm: async () => "sorry, no json here" });
    expect(r.directions).toEqual([]);
  });
});

describe("formatDesignDirections", () => {
  it("renders a numbered pick-one list", async () => {
    const r = await proposeVisualDirections("panel", { llm: async () => threeDirs });
    const md = formatDesignDirections(r);
    expect(md).toContain("pick one before building");
    expect(md).toContain("1. **Calm operator**");
    expect(md).toContain("var(--dpf-accent)");
  });
  it("renders a fallback when no directions", () => {
    expect(formatDesignDirections({ surface: "x", directions: [] })).toContain("fall back to DPF default tokens");
  });
});
