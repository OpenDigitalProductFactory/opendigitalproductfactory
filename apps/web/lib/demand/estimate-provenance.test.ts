import { describe, expect, it } from "vitest";

import { firstPassJobSize, resolveEstimateProvenance } from "./estimate-provenance";

describe("resolveEstimateProvenance", () => {
  it("is unestimated when neither side has a number", () => {
    expect(resolveEstimateProvenance({})).toEqual({
      effectiveJobSize: null,
      source: null,
      diverged: false,
      agreed: false,
    });
    // null/NaN/Infinity are treated as absent.
    expect(resolveEstimateProvenance({ aiJobSize: null, humanJobSize: undefined })).toMatchObject({
      effectiveJobSize: null,
      source: null,
    });
    expect(resolveEstimateProvenance({ aiJobSize: NaN, humanJobSize: Infinity })).toMatchObject({
      effectiveJobSize: null,
      source: null,
    });
  });

  it("uses the AI number when only the AI has estimated (first-pass, forward)", () => {
    expect(resolveEstimateProvenance({ aiJobSize: 8 })).toEqual({
      effectiveJobSize: 8,
      source: "ai",
      diverged: false,
      agreed: false,
    });
  });

  it("uses the human number when only the human has estimated", () => {
    expect(resolveEstimateProvenance({ humanJobSize: 3 })).toEqual({
      effectiveJobSize: 3,
      source: "human",
      diverged: false,
      agreed: false,
    });
  });

  it("surfaces divergence when AI and human disagree and are not reconciled", () => {
    // ⇄ 8 ↔ 3 · reconcile — the human number leads (humans decide), score provisional.
    expect(resolveEstimateProvenance({ aiJobSize: 8, humanJobSize: 3 })).toEqual({
      effectiveJobSize: 3,
      source: "human",
      diverged: true,
      agreed: false,
    });
  });

  it("auto-agrees when both sides land on the identical number (no explicit flag needed)", () => {
    expect(resolveEstimateProvenance({ aiJobSize: 5, humanJobSize: 5 })).toEqual({
      effectiveJobSize: 5,
      source: "agreed",
      diverged: false,
      agreed: true,
    });
  });

  it("treats an explicit agreement as reconciled and clears divergence", () => {
    // Human confirmed the estimate — even if the raw numbers differ, agreement wins.
    expect(resolveEstimateProvenance({ aiJobSize: 8, humanJobSize: 8, agreed: true })).toEqual({
      effectiveJobSize: 8,
      source: "agreed",
      diverged: false,
      agreed: true,
    });
    // A human confirming the AI's number (adopted into humanJobSize) reads as agreed.
    expect(resolveEstimateProvenance({ aiJobSize: 8, agreed: true, humanJobSize: 8 })).toMatchObject({
      source: "agreed",
      diverged: false,
    });
  });

  it("never reports divergence when only one side has estimated", () => {
    expect(resolveEstimateProvenance({ aiJobSize: 8, agreed: false }).diverged).toBe(false);
    expect(resolveEstimateProvenance({ humanJobSize: 3 }).diverged).toBe(false);
  });
});

describe("firstPassJobSize", () => {
  it("projects the t-shirt effort size to the shared job-size points", () => {
    expect(firstPassJobSize("small")).toBe(1);
    expect(firstPassJobSize("medium")).toBe(3);
    expect(firstPassJobSize("large")).toBe(8);
    expect(firstPassJobSize("xlarge")).toBe(20);
  });

  it("returns null when there is no effort size to project from", () => {
    expect(firstPassJobSize(null)).toBeNull();
    expect(firstPassJobSize(undefined)).toBeNull();
    expect(firstPassJobSize("")).toBeNull();
    expect(firstPassJobSize("enormous")).toBeNull();
  });
});
