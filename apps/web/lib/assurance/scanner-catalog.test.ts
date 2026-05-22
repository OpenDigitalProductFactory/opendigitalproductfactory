import { describe, expect, it } from "vitest";
import { resolveAssuranceScannerReadiness } from "./scanner-catalog";

describe("resolveAssuranceScannerReadiness", () => {
  it("reports needs-evaluation when no approved scanner exists", () => {
    expect(resolveAssuranceScannerReadiness({ approvedTools: [], evaluations: [] })).toEqual({
      state: "needs-evaluation",
      approvedScannerCount: 0,
      scannerNames: [],
      reason: "no-approved-scanner",
    });
  });

  it("accepts approved registry scanner entries without hardcoding UI names", () => {
    expect(resolveAssuranceScannerReadiness({
      approvedTools: [
        {
          toolName: "Example Scanner",
          toolType: "docker_image",
          approvedVersion: "1.0.0",
          allowedVersionRange: null,
          conditions: ["assurance:scanner:vulnerability"],
          environments: ["sandbox"],
          evaluationId: "eval_1",
          approvedAt: "2026-05-22T00:00:00.000Z",
          reEvaluateAt: "2026-08-22T00:00:00.000Z",
          status: "active",
        },
      ],
      evaluations: [],
    })).toEqual({
      state: "ready",
      approvedScannerCount: 1,
      scannerNames: ["Example Scanner"],
      reason: "approved-scanner-available",
    });
  });
});
