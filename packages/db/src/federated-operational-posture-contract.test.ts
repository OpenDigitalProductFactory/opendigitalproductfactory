import { describe, expect, it } from "vitest";
import { projectEstatePayload } from "./projection-serialization";
import {
  OPERATIONAL_POSTURE_PROJECTION_TEMPLATE,
  OPERATIONAL_POSTURE_SCHEMA_VERSIONS,
  POSTURE_HEALTH_STATUSES,
  computeOperationalPosturePayloadDigest,
  validateOperationalPostureV1,
  type OperationalPostureV1,
} from "./federated-operational-posture-contract";

const posture = (overrides: Partial<OperationalPostureV1> = {}): OperationalPostureV1 => {
  const value: OperationalPostureV1 = {
    specVersion: "dpf.operational-posture/1",
    originInstallationId: "inst_opaque_a",
    originVersion: 1,
    servedVersion: "2026.7.0",
    servedSha: "deadbeefcafe",
    patchPosture: { critical: 0, high: 1, medium: 3, low: 5 },
    health: { status: "healthy", estateItemCount: 42 },
    runtime: { targetCount: 4, healthyCount: 4 },
    resourceFootprint: { cpuCores: 8, memoryMb: 16_384 },
    capturedAt: "2026-07-19T20:00:00.000Z",
    payloadDigest: "sha256:pending",
    ...overrides,
  };
  if (overrides.payloadDigest === undefined) value.payloadDigest = computeOperationalPosturePayloadDigest(value);
  return value;
};

describe("federated operational-posture registries", () => {
  it("pins the v1 schema version and health vocabulary", () => {
    expect(OPERATIONAL_POSTURE_SCHEMA_VERSIONS).toEqual(["dpf.operational-posture/1"]);
    expect(POSTURE_HEALTH_STATUSES).toEqual(["healthy", "degraded", "offline"]);
  });
});

describe("validateOperationalPostureV1", () => {
  it("accepts a conforming posture record", () => {
    expect(validateOperationalPostureV1(posture())).toEqual([]);
  });

  it("flags a malformed posture — bad status, negative counts, healthy>target, non-advancing version", () => {
    const invalid = {
      ...posture(),
      health: { status: "on-fire", estateItemCount: -1 },
      patchPosture: { critical: -2, high: 1, medium: 3, low: 5 },
      runtime: { targetCount: 2, healthyCount: 9 },
    };
    expect(validateOperationalPostureV1(invalid, { previousOriginVersion: 1 })).toEqual(expect.arrayContaining([
      "health.status:unsupported",
      "health.estateItemCount:invalid",
      "patchPosture.critical:invalid",
      "runtime.healthyCount:exceeds-target",
      "originVersion:not-advancing",
    ]));
  });

  it("rejects host-identifying fields so a raw estate row cannot masquerade as posture", () => {
    expect(validateOperationalPostureV1({
      ...posture(),
      hostname: "prod-node-1",
      ipAddress: "10.0.0.4",
      findings: [{ cve: "CVE-0000", host: "prod-node-1" }],
    })).toEqual(expect.arrayContaining([
      "field:not-allowed:hostname",
      "field:not-allowed:ipAddress",
      "field:not-allowed:findings",
    ]));
  });

  it("rejects a payload whose claimed digest does not match its content", () => {
    expect(validateOperationalPostureV1(posture({ payloadDigest: `sha256:${"0".repeat(64)}` })))
      .toContain("payloadDigest:mismatch");
  });
});

describe("computeOperationalPosturePayloadDigest", () => {
  it("is stable (idempotent) for identical input", () => {
    expect(computeOperationalPosturePayloadDigest(posture()))
      .toBe(computeOperationalPosturePayloadDigest(posture()));
  });

  it("changes when the posture body changes", () => {
    const base = posture();
    const changed = posture({ patchPosture: { critical: 1, high: 1, medium: 3, low: 5 } });
    expect(computeOperationalPosturePayloadDigest(changed))
      .not.toBe(computeOperationalPosturePayloadDigest(base));
  });
});

describe("OPERATIONAL_POSTURE_PROJECTION_TEMPLATE", () => {
  it("never projects host-identifying or raw estate state", () => {
    const result = projectEstatePayload(OPERATIONAL_POSTURE_PROJECTION_TEMPLATE, {
      posture: {
        ...posture(),
        hostname: "prod-node-1",
        ipAddress: "10.0.0.4",
        nodeId: "node-secret",
      },
      hostDetails: { hostname: "prod-node-1" },
      estateItems: [{ id: "asset-secret" }],
    });

    expect(result.projected).toHaveProperty("posture");
    expect(JSON.stringify(result.projected)).not.toContain("prod-node-1");
    expect(JSON.stringify(result.projected)).not.toContain("10.0.0.4");
    expect(JSON.stringify(result.projected)).not.toContain("node-secret");
    expect(JSON.stringify(result.projected)).not.toContain("asset-secret");
    expect(result.excluded.slices).toEqual(expect.arrayContaining(["hostDetails", "estateItems"]));
  });
});
