import { describe, expect, it } from "vitest";

import { resolveHostResourcePoolPolicy } from "./environment-lease-pool-policy";

const GiB = 1024 ** 3;

describe("resolveHostResourcePoolPolicy", () => {
  it("projects an admitted request into the existing lease capacity contract", () => {
    expect(resolveHostResourcePoolPolicy({
      resourceClass: "next-build",
      expectedMemoryBytes: 16 * GiB,
      hostResource: {
        totalMemoryBytes: 64 * GiB,
        availableMemoryBytes: 30 * GiB,
        inferenceResident: true,
      },
      activeReservations: [],
    })).toMatchObject({
      policyVersion: 1,
      source: "host-resource-profile",
      effectiveCapacity: 1,
      slotKeys: ["slot-0"],
      rollbackReason: null,
    });
  });

  it("projects a full singleton as zero currently available capacity", () => {
    expect(resolveHostResourcePoolPolicy({
      resourceClass: "vitest",
      expectedMemoryBytes: 8 * GiB,
      hostResource: {
        totalMemoryBytes: 64 * GiB,
        availableMemoryBytes: 24 * GiB,
        inferenceResident: true,
      },
      activeReservations: [{ resourceClass: "next-build", expectedMemoryBytes: 16 * GiB }],
    })).toMatchObject({
      effectiveCapacity: 0,
      slotKeys: [],
      rollbackReason: "inference-resident-singleton",
    });
  });
});
