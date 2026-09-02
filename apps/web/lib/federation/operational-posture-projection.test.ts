import { describe, expect, it } from "vitest";

import { OPERATIONAL_POSTURE_PROJECTION_TEMPLATE } from "@dpf/db/federated-operational-posture-contract";

import { buildOperationalPostureRecord } from "./operational-posture-projection";

const source = {
  servedVersion: "2026.7.0",
  servedSha: "deadbeefcafe",
  patchPosture: { critical: 0, high: 2, medium: 4, low: 7 },
  health: { status: "degraded" as const, estateItemCount: 128 },
  runtime: { targetCount: 3, healthyCount: 2 },
  resourceFootprint: { cpuCores: 8, memoryMb: 16_384 },
  capturedAt: new Date("2026-07-20T06:00:00.000Z"),
  updatedAt: new Date("2026-07-20T06:05:00.000Z"),
};

const identity = { installationId: `inst_${"a".repeat(32)}`, projectionSecret: "b".repeat(64) };

describe("buildOperationalPostureRecord", () => {
  it("projects a valid minimized posture record with a stable digest", () => {
    const result = buildOperationalPostureRecord({ source, identity });

    expect(result.violations).toEqual([]);
    expect(result.record).toMatchObject({
      specVersion: "dpf.operational-posture/1",
      originInstallationId: identity.installationId,
      servedVersion: source.servedVersion,
      servedSha: source.servedSha,
      patchPosture: { critical: 0, high: 2, medium: 4, low: 7 },
      health: { status: "degraded", estateItemCount: 128 },
      runtime: { targetCount: 3, healthyCount: 2 },
      originVersion: source.updatedAt.getTime(),
    });
    expect(result.record.payloadDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("emits no excluded egress and re-projecting an unchanged source is idempotent", () => {
    const first = buildOperationalPostureRecord({ source, identity });
    const second = buildOperationalPostureRecord({ source, identity });

    // assertNoExcludedEgress contributes to violations; an empty list proves the
    // projection is provably minimum-necessary.
    expect(first.violations).toEqual([]);
    expect(second.record.originVersion).toBe(first.record.originVersion);
    expect(second.record.payloadDigest).toBe(first.record.payloadDigest);
  });

  it("never serializes raw or host-identifying source fields", () => {
    const result = buildOperationalPostureRecord({
      source: {
        ...source,
        hostname: "prod-node-7",
        ipAddress: "10.1.2.3",
        rawFindings: [{ cve: "CVE-9999", host: "prod-node-7" }],
      } as typeof source,
      identity,
    });

    expect(result.violations).toEqual([]);
    const serialized = JSON.stringify(result.record);
    expect(serialized).not.toContain("prod-node-7");
    expect(serialized).not.toContain("10.1.2.3");
    expect(serialized).not.toContain("CVE-9999");
    expect(result.record).not.toHaveProperty("hostname");
    expect(result.record).not.toHaveProperty("rawFindings");
  });

  it("honors a narrower contract that drops the optional resource footprint", () => {
    const result = buildOperationalPostureRecord({
      source,
      identity,
      contract: {
        ...OPERATIONAL_POSTURE_PROJECTION_TEMPLATE,
        fieldAllowList: {
          posture: [
            "specVersion", "originInstallationId", "originVersion", "servedVersion", "servedSha",
            "patchPosture", "health", "runtime", "capturedAt", "payloadDigest",
          ],
        },
      },
    });

    expect(result.violations).toEqual([]);
    expect(result.record).not.toHaveProperty("resourceFootprint");
  });
});
