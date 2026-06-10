// apps/web/lib/queue/admission.test.ts
import { describe, expect, it } from "vitest";
import {
  parseBuildPipelineLimit,
  buildPipelineConcurrency,
  BUILD_PIPELINE_LANE_KEY,
} from "./admission";

describe("parseBuildPipelineLimit", () => {
  it("returns null when unset/empty (lane disabled by default)", () => {
    expect(parseBuildPipelineLimit(undefined)).toBeNull();
    expect(parseBuildPipelineLimit(null)).toBeNull();
    expect(parseBuildPipelineLimit("")).toBeNull();
  });

  it("returns null for non-positive or non-integer values", () => {
    expect(parseBuildPipelineLimit("0")).toBeNull();
    expect(parseBuildPipelineLimit("-2")).toBeNull();
    expect(parseBuildPipelineLimit("3.5")).toBeNull();
    expect(parseBuildPipelineLimit("abc")).toBeNull();
  });

  it("parses a positive integer cap", () => {
    expect(parseBuildPipelineLimit("4")).toBe(4);
  });
});

describe("buildPipelineConcurrency", () => {
  const base = { limit: 2 } as const;

  it("returns just the base when the lane is disabled — zero behavior change", () => {
    expect(buildPipelineConcurrency(base, null)).toEqual([base]);
  });

  it("appends one shared account-scoped constraint with the constant key when set", () => {
    const conc = buildPipelineConcurrency(base, 4);
    expect(conc).toHaveLength(2);
    expect(conc[0]).toEqual(base);
    expect(conc[1]?.scope).toBe("account");
    expect(conc[1]?.limit).toBe(4);
    // Constant CEL string literal so all enrolled functions share one queue.
    expect(conc[1]?.key).toBe(`'${BUILD_PIPELINE_LANE_KEY}'`);
  });
});
