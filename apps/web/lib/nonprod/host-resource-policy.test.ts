import { describe, expect, it } from "vitest";

import {
  DEFAULT_HEAVY_RESOURCE_PROFILES,
  resolveHostResourceAdmission,
  type HostResourceAdmissionInput,
} from "./host-resource-policy";

const GiB = 1024 ** 3;

function request(
  overrides: Partial<HostResourceAdmissionInput> = {},
): HostResourceAdmissionInput {
  return {
    resourceClass: "vitest",
    expectedMemoryBytes: DEFAULT_HEAVY_RESOURCE_PROFILES.vitest.expectedMemoryBytes,
    totalMemoryBytes: 64 * GiB,
    availableMemoryBytes: 30 * GiB,
    activeHeavyReservations: [],
    inferenceResident: true,
    ...overrides,
  };
}

describe("resolveHostResourceAdmission", () => {
  it("admits one heavyweight workload on a 64 GiB host while inference is resident", () => {
    expect(resolveHostResourceAdmission(request())).toMatchObject({
      status: "admitted",
      resourceClass: "vitest",
      capacity: 1,
      reason: "capacity-available",
    });
  });

  it("queues a second heavyweight workload while inference is resident", () => {
    expect(resolveHostResourceAdmission(request({
      activeHeavyReservations: [{ resourceClass: "next-build", expectedMemoryBytes: 16 * GiB }],
    }))).toMatchObject({
      status: "queued",
      capacity: 1,
      reason: "inference-resident-singleton",
      retryAfterSeconds: 30,
    });
  });

  it("keeps local inference itself single-flight even when host memory could fit two models", () => {
    expect(resolveHostResourceAdmission(request({
      resourceClass: "inference",
      expectedMemoryBytes: DEFAULT_HEAVY_RESOURCE_PROFILES.inference.expectedMemoryBytes,
      totalMemoryBytes: 128 * GiB,
      availableMemoryBytes: 100 * GiB,
      inferenceResident: false,
      activeHeavyReservations: [{
        resourceClass: "inference",
        expectedMemoryBytes: DEFAULT_HEAVY_RESOURCE_PROFILES.inference.expectedMemoryBytes,
      }],
    }))).toMatchObject({
      status: "queued",
      capacity: 1,
      reason: "heavy-capacity-full",
    });
  });

  it("keeps cheap source-local guards outside heavyweight admission", () => {
    expect(resolveHostResourceAdmission(request({ resourceClass: "cheap-guard" }))).toEqual({
      status: "bypass",
      resourceClass: "cheap-guard",
      reason: "not-heavyweight",
    });
  });

  it("fails closed for an unknown resource class", () => {
    expect(resolveHostResourceAdmission(request({ resourceClass: "mystery" }))).toMatchObject({
      status: "blocked",
      reason: "unknown-resource-class",
    });
  });

  it("queues when admitting the request would spend the host and inference reserve", () => {
    expect(resolveHostResourceAdmission(request({
      availableMemoryBytes: 15 * GiB,
      resourceClass: "next-build",
      expectedMemoryBytes: 16 * GiB,
    }))).toMatchObject({
      status: "queued",
      reason: "host-memory-reserve",
    });
  });

  it("uses calibrated expected memory only when it is no lower than the governed floor", () => {
    expect(resolveHostResourceAdmission(request({
      expectedMemoryBytes: 1 * GiB,
    }))).toMatchObject({
      status: "blocked",
      reason: "expected-memory-below-governed-floor",
    });
  });
});
