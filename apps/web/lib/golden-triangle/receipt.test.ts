import { describe, expect, it } from "vitest";

import { compileGoldenTrianglePolicy } from "@/lib/golden-triangle";
import type { GoldenTrianglePreference } from "@/lib/golden-triangle";

import { buildGoldenTriangleReceipt } from "./receipt";

const ASSURED: GoldenTrianglePreference = { preset: "assured", qualityWeight: 0.8, costWeight: 0.1, timeWeight: 0.1 };
const BALANCED: GoldenTrianglePreference = { preset: "balanced", qualityWeight: 0.34, costWeight: 0.33, timeWeight: 0.33 };

function decode(pref: GoldenTrianglePreference) {
  return compileGoldenTrianglePolicy({ preference: pref, taskClass: "code-gen", authorityScope: { kind: "wwmd" } });
}

describe("buildGoldenTriangleReceipt", () => {
  it("matches when the actual model meets the requested frontier tier", () => {
    const r = buildGoldenTriangleReceipt(ASSURED, decode(ASSURED), {
      modelId: "claude-opus-4-7-20250514",
      costUsd: 0.12,
      latencyMs: 14000,
    });
    expect(r.requested.minimumTier).toBe("frontier");
    expect(r.actual.tier).toBe("frontier");
    expect(r.matchedRequest).toBe(true);
    expect(r.summary).toMatch(/matched/);
    expect(r.summary).toMatch(/\$0\.120/);
    expect(r.summary).toMatch(/14\.0s/);
  });

  it("flags a tier downgrade when the actual model is below the requested tier", () => {
    const r = buildGoldenTriangleReceipt(ASSURED, decode(ASSURED), {
      modelId: "gpt-4o-mini",
      costUsd: 0.002,
      latencyMs: 3000,
    });
    expect(r.actual.tier).toBe("adequate");
    expect(r.matchedRequest).toBe(false);
    expect(r.deviations.some((d) => d.field === "tier" && d.kind === "downgrade")).toBe(true);
    expect(r.summary).toMatch(/below the requested tier/);
  });

  it("distinguishes an infra failover from a posture downgrade", () => {
    const r = buildGoldenTriangleReceipt(ASSURED, decode(ASSURED), {
      modelId: "claude-opus-4-7-20250514", // tier still meets frontier
      costUsd: 0.1,
      latencyMs: 11000,
      fallbackOccurred: true,
    });
    expect(r.deviations.some((d) => d.field === "tier" && d.kind === "match")).toBe(true);
    expect(r.deviations.some((d) => d.field === "routing" && d.kind === "downgrade")).toBe(true);
    expect(r.matchedRequest).toBe(false);
    expect(r.summary).toMatch(/downgraded by failover/);
  });

  it("Balanced has no tier requirement, so any healthy run matches", () => {
    const r = buildGoldenTriangleReceipt(BALANCED, decode(BALANCED), {
      modelId: "gpt-4o-mini",
      costUsd: 0.001,
      latencyMs: 2500,
    });
    expect(r.requested.minimumTier).toBeUndefined();
    expect(r.matchedRequest).toBe(true);
    expect(r.deviations.some((d) => d.kind === "downgrade")).toBe(false);
  });

  it("derives the actual tier from the model id and handles missing cost", () => {
    const r = buildGoldenTriangleReceipt(BALANCED, decode(BALANCED), { modelId: "claude-haiku-4-5-20251001" });
    expect(r.actual.tier).toBe("strong");
    expect(r.actual.costUsd).toBeNull();
    expect(r.summary).toMatch(/cost n\/a/);
  });

  it("records which scope governed the run; defaults to none", () => {
    const noScope = buildGoldenTriangleReceipt(ASSURED, decode(ASSURED), { modelId: "claude-opus-4-7-20250514" });
    expect(noScope.governedBy).toBe("none");
    const agentScope = buildGoldenTriangleReceipt(
      ASSURED,
      decode(ASSURED),
      { modelId: "claude-opus-4-7-20250514" },
      "agent",
    );
    expect(agentScope.governedBy).toBe("agent");
  });
});
