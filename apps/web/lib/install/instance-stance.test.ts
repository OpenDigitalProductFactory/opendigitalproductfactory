import { describe, expect, it } from "vitest";

import {
  BACKLOG_CAPTURE_CONFIG_KEY,
  OPERATING_INTENT_CONFIG_KEY,
  holdsIrreplaceableWork,
  loadInstanceStance,
  readInstallEnvironmentClass,
  type InstanceStanceStore,
} from "./instance-stance";

const CONFIRMED_DEV_INTENT = {
  schemaVersion: 1,
  primaryPurpose: "evolve-dpf",
  secondaryPurposes: [],
  relationshipIntents: [],
  pairedProductionInstallationRef: "operator-production",
  evidence: [],
  confidence: "high",
  confirmation: {
    status: "confirmed",
    confirmedAt: "2026-08-22T03:37:19.586Z",
    confirmedByPrincipalId: "PRN-test",
  },
};

function store(overrides: Partial<InstanceStanceStore> = {}): InstanceStanceStore {
  return {
    readConfig: async () => null,
    countBacklogItemsByStatus: async () => 0,
    ...overrides,
  };
}

function stateText(environmentClass?: string) {
  return async () =>
    JSON.stringify(environmentClass ? { environmentClass } : { installMode: "consumer" });
}

describe("readInstallEnvironmentClass", () => {
  it("reads a declared environment class from installer state", async () => {
    const result = await readInstallEnvironmentClass({ readText: stateText("development") });
    expect(result).toEqual({ environmentClass: "development", declared: true });
  });

  it("falls back to production when nothing is declared", async () => {
    const result = await readInstallEnvironmentClass({ readText: stateText() });
    expect(result).toEqual({ environmentClass: "production", declared: false });
  });

  it("falls back to production when installer state cannot be read", async () => {
    const result = await readInstallEnvironmentClass({
      readText: async () => {
        throw new Error("ENOENT");
      },
    });
    expect(result.environmentClass).toBe("production");
    expect(result.declared).toBe(false);
  });

  it("rejects a value outside the closed vocabulary", async () => {
    const result = await readInstallEnvironmentClass({ readText: stateText("staging") });
    expect(result.environmentClass).toBe("production");
  });
});

describe("holdsIrreplaceableWork", () => {
  it("is false when there is no unfinished work", () => {
    expect(holdsIrreplaceableWork({ unfinishedItemCount: 0, receipt: null })).toBe(false);
  });

  it("is true when unfinished work has never been captured", () => {
    expect(holdsIrreplaceableWork({ unfinishedItemCount: 3, receipt: null })).toBe(true);
  });

  it("is false when a capture covers the current unfinished work", () => {
    expect(
      holdsIrreplaceableWork({
        unfinishedItemCount: 3,
        receipt: {
          schemaVersion: 1,
          capturedAt: "2026-08-22T10:00:00.000Z",
          bundlePath: "/d/DPF-backups/backlog",
          itemCount: 3,
          unfinishedItemCount: 3,
        },
      }),
    ).toBe(false);
  });

  it("is true when work was added after the last capture", () => {
    expect(
      holdsIrreplaceableWork({
        unfinishedItemCount: 5,
        receipt: {
          schemaVersion: 1,
          capturedAt: "2026-08-22T10:00:00.000Z",
          bundlePath: "/d/DPF-backups/backlog",
          itemCount: 3,
          unfinishedItemCount: 3,
        },
      }),
    ).toBe(true);
  });
});

describe("loadInstanceStance", () => {
  it("composes a development companion paired with production", async () => {
    const stance = await loadInstanceStance(
      store({
        readConfig: async (key) =>
          key === OPERATING_INTENT_CONFIG_KEY ? CONFIRMED_DEV_INTENT : null,
        countBacklogItemsByStatus: async () => 42,
      }),
      {
        readText: stateText("development"),
        readHostProfile: async () => ({
          kind: "consumer" as const,
          installMode: "consumer",
          sourceCapable: false,
          releaseImage: true,
          reason: "consumer-release-install" as const,
        }),
      },
    );
    expect(stance.environmentClass).toBe("development");
    expect(stance.primaryPurpose).toBe("evolve-dpf");
    expect(stance.teardown).toBe("capture-required");
    expect(stance.peerWrite).toBe("read-only");
    expect(stance.sourceAuthority).toBe("none");
    expect(stance.credentials).toBe("local-permitted");
  });

  it("permits teardown once a capture receipt covers the work", async () => {
    const stance = await loadInstanceStance(
      store({
        readConfig: async (key) => {
          if (key === OPERATING_INTENT_CONFIG_KEY) return CONFIRMED_DEV_INTENT;
          if (key === BACKLOG_CAPTURE_CONFIG_KEY) {
            return {
              schemaVersion: 1,
              capturedAt: "2026-08-22T10:00:00.000Z",
              bundlePath: "/d/DPF-backups/backlog",
              itemCount: 42,
              unfinishedItemCount: 42,
            };
          }
          return null;
        },
        countBacklogItemsByStatus: async () => 42,
      }),
      {
        readText: stateText("development"),
        readHostProfile: async () => ({
          kind: "consumer" as const,
          installMode: "consumer",
          sourceCapable: false,
          releaseImage: true,
          reason: "consumer-release-install" as const,
        }),
      },
    );
    expect(stance.teardown).toBe("permitted");
  });

  it("falls back to the cautious stance when the store cannot be read", async () => {
    const stance = await loadInstanceStance(
      store({
        readConfig: async () => {
          throw new Error("db down");
        },
        countBacklogItemsByStatus: async () => {
          throw new Error("db down");
        },
      }),
      {
        readText: async () => {
          throw new Error("ENOENT");
        },
        readHostProfile: async () => ({
          kind: "unknown" as const,
          installMode: null,
          sourceCapable: false,
          releaseImage: false,
          reason: "insufficient-install-evidence" as const,
        }),
      },
    );
    // Nothing could be established, so every brake is on.
    expect(stance.environmentClass).toBe("production");
    expect(stance.teardown).toBe("forbidden");
    expect(stance.credentials).toBe("operator-only");
    expect(stance.holdsIrreplaceableWork).toBe(true);
  });
});
