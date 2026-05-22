import { describe, expect, it } from "vitest";
import {
  getPlatformNativeScannerNames,
  platformNativeOnlyReadiness,
  resolveAssuranceScannerReadiness,
} from "./scanner-catalog";

describe("resolveAssuranceScannerReadiness", () => {
  it("reports needs-evaluation when no approved or platform-native scanner exists", () => {
    expect(resolveAssuranceScannerReadiness({
      approvedTools: [],
      evaluations: [],
      includePlatformNative: false,
    })).toEqual({
      state: "needs-evaluation",
      approvedScannerCount: 0,
      scannerNames: [],
      reason: "no-approved-scanner",
    });
  });

  it("reports ready with platform-native reason when only pnpm-audit is bundled", () => {
    const readiness = platformNativeOnlyReadiness();

    expect(readiness.state).toBe("ready");
    expect(readiness.reason).toBe("platform-native-scanner-available");
    expect(readiness.scannerNames).toContain("pnpm-audit");
  });

  it("exposes platform-native scanner list", () => {
    expect(getPlatformNativeScannerNames()).toContain("pnpm-audit");
  });

  it("accepts approved registry scanner entries and reports approved-scanner reason", () => {
    const readiness = resolveAssuranceScannerReadiness({
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
    });

    expect(readiness.state).toBe("ready");
    expect(readiness.reason).toBe("approved-scanner-available");
    expect(readiness.scannerNames).toContain("Example Scanner");
    expect(readiness.scannerNames).toContain("pnpm-audit");
  });
});
