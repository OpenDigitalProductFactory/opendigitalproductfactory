import { describe, expect, it } from "vitest";
import { evaluateArtifactContract } from "./build-provenance-contracts";

describe("evaluateArtifactContract", () => {
  it("surfaces missing verification receipts as warnings in shadow mode", () => {
    const result = evaluateArtifactContract({
      acceptedArtifacts: {},
      enforcementMode: "shadow",
      field: "verificationOut",
      receiptSummaries: [],
      value: { typecheckPassed: true, testsPassed: 4, testsFailed: 0 },
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([
      "verificationOut requires at least one verification receipt",
      "verificationOut requires a sandbox-test-run or sandbox-command receipt",
    ]);
    expect(result.warnings).toEqual(result.errors);
  });

  it("blocks acceptanceMet in enforce mode when no accepted verification artifact exists", () => {
    const result = evaluateArtifactContract({
      acceptedArtifacts: {},
      enforcementMode: "enforce",
      field: "acceptanceMet",
      receiptSummaries: [],
      value: [{ criterion: "Header remains visible", met: true }],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "acceptanceMet requires an accepted verificationOut artifact",
    );
  });
});
