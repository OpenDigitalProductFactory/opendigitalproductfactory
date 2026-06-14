import { describe, expect, it, vi } from "vitest";
import {
  classifyUiSurfaceTier,
  scoreUiSurfaceChange,
  uiSurfaceFeatures,
  type UiSurfaceChange,
} from "./ui-surface-features";

const base: UiSurfaceChange = {
  controlsAdded: 0,
  controlsRemoved: 0,
  justification: "none",
  reuseBreadth: 0,
  clarifiesOutcome: 0,
};

describe("classifyUiSurfaceTier", () => {
  it("no-op when no surface changes", () => {
    expect(classifyUiSurfaceTier(base)).toBe("no-op");
  });

  it("removal when surface is only retired", () => {
    expect(classifyUiSurfaceTier({ ...base, controlsRemoved: 2 })).toBe("removal");
  });

  it("low for a net addition with inadequate justification (even if reusable)", () => {
    expect(
      classifyUiSurfaceTier({
        ...base,
        controlsAdded: 1,
        justification: "none",
        reuseBreadth: 1,
        clarifiesOutcome: 1,
      }),
    ).toBe("low");
  });

  it("mid for a justified addition with narrow reuse / no clarification", () => {
    expect(
      classifyUiSurfaceTier({
        ...base,
        controlsAdded: 1,
        justification: "researched",
        reuseBreadth: 0.2,
        clarifiesOutcome: 0.2,
      }),
    ).toBe("mid");
  });

  it("high for a justified, clarifying, broadly-reusable addition", () => {
    expect(
      classifyUiSurfaceTier({
        ...base,
        controlsAdded: 1,
        justification: "researched",
        reuseBreadth: 0.8,
        clarifiesOutcome: 0.8,
      }),
    ).toBe("high");
  });
});

describe("uiSurfaceFeatures", () => {
  it("imposes high cognitive load for an unjustified net addition", () => {
    const { ship } = uiSurfaceFeatures({ ...base, controlsAdded: 1, justification: "none" });
    expect(ship.human_cognitive_load).toBeGreaterThan(0.7);
    expect(ship.evidence_density).toBeLessThan(0.2);
  });

  it("buys load down for a justified, reusable, clarifying addition", () => {
    const { ship } = uiSurfaceFeatures({
      ...base,
      controlsAdded: 1,
      justification: "researched",
      reuseBreadth: 0.9,
      clarifiesOutcome: 0.9,
    });
    expect(ship.human_cognitive_load).toBeLessThan(0.2);
    expect(ship.reusability).toBeGreaterThan(0.8);
    expect(ship.evidence_density).toBeCloseTo(0.9);
  });

  it("net removal imposes near-zero load on the ship option", () => {
    const { ship } = uiSurfaceFeatures({ ...base, controlsAdded: 1, controlsRemoved: 3, justification: "weak" });
    expect(ship.human_cognitive_load).toBeCloseTo(0.1);
  });

  it("retire baseline is constant and favors removal (low load, high maintainability)", () => {
    const { retire } = uiSurfaceFeatures({ ...base, controlsAdded: 2, justification: "researched" });
    expect(retire.human_cognitive_load).toBeLessThan(0.1);
    expect(retire.long_term_maintainability).toBeGreaterThan(0.8);
  });

  it("keeps every feature within [0,1]", () => {
    const { ship, retire } = uiSurfaceFeatures({
      ...base,
      controlsAdded: 5,
      justification: "researched",
      reuseBreadth: 1,
      clarifiesOutcome: 1,
    });
    for (const v of [...Object.values(ship), ...Object.values(retire)]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("scoreUiSurfaceChange", () => {
  it("short-circuits no-op without calling the kernel", async () => {
    const exec = vi.fn();
    const v = await scoreUiSurfaceChange(base, { userId: "u1", toolExecutor: exec });
    expect(v.gate).toBe("no-op");
    expect(v.pass).toBe(true);
    expect(exec).not.toHaveBeenCalled();
  });

  it("passes a pure removal without calling the kernel", async () => {
    const exec = vi.fn();
    const v = await scoreUiSurfaceChange(
      { ...base, controlsRemoved: 2 },
      { userId: "u1", toolExecutor: exec },
    );
    expect(v.tier).toBe("removal");
    expect(v.gate).toBe("pass");
    expect(exec).not.toHaveBeenCalled();
  });

  it("passes when ship beats retire with high confidence", async () => {
    const exec = vi.fn().mockResolvedValue({
      success: true,
      data: {
        recommendation: { optionId: "ship", confidence: "high", margin: 0.3 },
        scores: [{ optionId: "ship" }],
        reasoning: "Ship earns its surface.",
      },
    });
    const v = await scoreUiSurfaceChange(
      { ...base, controlsAdded: 1, justification: "researched", reuseBreadth: 0.9, clarifiesOutcome: 0.9 },
      { userId: "u1", toolExecutor: exec },
    );
    expect(exec).toHaveBeenCalledOnce();
    expect(exec.mock.calls[0][0]).toBe("principle_decide");
    expect(v.gate).toBe("pass");
    expect(v.pass).toBe(true);
    expect(v.tier).toBe("high");
  });

  it("soft-blocks when retire beats ship (unjustified surface)", async () => {
    const exec = vi.fn().mockResolvedValue({
      success: true,
      data: {
        recommendation: { optionId: "retire", confidence: "high", margin: 0.4 },
        scores: [{ optionId: "retire" }],
        reasoning: "Removal beats unjustified surface.",
      },
    });
    const v = await scoreUiSurfaceChange(
      { ...base, controlsAdded: 1, justification: "none" },
      { userId: "u1", toolExecutor: exec },
    );
    expect(v.gate).toBe("soft-block");
    expect(v.pass).toBe(false);
    expect(v.tier).toBe("low");
  });

  it("soft-blocks when ship wins but only at low confidence", async () => {
    const exec = vi.fn().mockResolvedValue({
      success: true,
      data: {
        recommendation: { optionId: "ship", confidence: "low", margin: 0.05 },
        scores: [],
        reasoning: "Close call.",
      },
    });
    const v = await scoreUiSurfaceChange(
      { ...base, controlsAdded: 1, justification: "weak", reuseBreadth: 0.3, clarifiesOutcome: 0.3 },
      { userId: "u1", toolExecutor: exec },
    );
    expect(v.gate).toBe("soft-block");
    expect(v.pass).toBe(false);
  });
});
