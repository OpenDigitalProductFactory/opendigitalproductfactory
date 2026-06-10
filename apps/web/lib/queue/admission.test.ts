// apps/web/lib/queue/admission.test.ts
import { describe, expect, it } from "vitest";
import {
  parseBuildPipelineLimit,
  buildPipelineLane,
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

describe("buildPipelineLane", () => {
  it("is empty when the lane is disabled — zero behavior change", () => {
    expect(buildPipelineLane(null)).toEqual([]);
  });

  it("emits one shared account-scoped constraint with the constant key when set", () => {
    const lane = buildPipelineLane(4);
    expect(lane).toHaveLength(1);
    expect(lane[0].scope).toBe("account");
    expect(lane[0].limit).toBe(4);
    // Constant CEL string literal so all enrolled functions share one queue.
    expect(lane[0].key).toBe(`'${BUILD_PIPELINE_LANE_KEY}'`);
  });
});
