import { describe, expect, it } from "vitest";

import { ENVIRONMENT_CLASS_CONFIG_KEY } from "./environment-class";
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

const consumerHost = async () => ({
  kind: "consumer" as const,
  installMode: "consumer",
  sourceCapable: false,
  releaseImage: true,
  reason: "consumer-release-install" as const,
});

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
  const receipt = (capturedAt: string, unfinishedItemCount: number) => ({
    schemaVersion: 1 as const,
    capturedAt,
    bundlePath: "/d/DPF-backups/backlog",
    itemCount: unfinishedItemCount,
    unfinishedItemCount,
  });

  it("is false when there is no unfinished work", () => {
    expect(holdsIrreplaceableWork({ unfinishedItemCount: 0, receipt: null })).toBe(false);
  });

  it("is true when unfinished work has never been captured", () => {
    expect(holdsIrreplaceableWork({ unfinishedItemCount: 3, receipt: null })).toBe(true);
  });

  it("is false when every unfinished item predates the capture", () => {
    expect(
      holdsIrreplaceableWork({
        unfinishedItemCount: 3,
        receipt: receipt("2026-08-22T10:00:00.000Z", 3),
        latestUnfinishedChangeAt: "2026-08-22T09:59:00.000Z",
      }),
    ).toBe(false);
  });

  it("is true when work was added after the last capture", () => {
    expect(
      holdsIrreplaceableWork({
        unfinishedItemCount: 5,
        receipt: receipt("2026-08-22T10:00:00.000Z", 3),
        latestUnfinishedChangeAt: "2026-08-22T11:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("is true when an item was edited after the capture even though none were added", () => {
    expect(
      holdsIrreplaceableWork({
        unfinishedItemCount: 3,
        receipt: receipt("2026-08-22T10:00:00.000Z", 3),
        latestUnfinishedChangeAt: "2026-08-22T10:00:00.001Z",
      }),
    ).toBe(true);
  });

  // BI-9CE1A6C8. The count-based predecessor returned false here, reporting
  // "no uncaptured work" over 75 unbundled items, because the backlog had
  // SHRUNK since the capture (111 -> 98) while its composition changed.
  it("is true when the backlog shrank but newer work is uncaptured", () => {
    expect(
      holdsIrreplaceableWork({
        unfinishedItemCount: 98,
        receipt: receipt("2026-08-24T06:13:10.775Z", 111),
        latestUnfinishedChangeAt: "2026-08-25T23:44:00.000Z",
      }),
    ).toBe(true);
  });

  // The degenerate case: close one, file one. The count never moves, so a
  // count comparison can never detect it.
  it("is true when the count is unchanged but an item is newer than the capture", () => {
    expect(
      holdsIrreplaceableWork({
        unfinishedItemCount: 40,
        receipt: receipt("2026-08-22T10:00:00.000Z", 40),
        latestUnfinishedChangeAt: "2026-08-23T08:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("fails closed when the recency instant is missing", () => {
    expect(
      holdsIrreplaceableWork({
        unfinishedItemCount: 3,
        receipt: receipt("2026-08-22T10:00:00.000Z", 3),
      }),
    ).toBe(true);
  });

  it("fails closed when the receipt instant is unparseable", () => {
    expect(
      holdsIrreplaceableWork({
        unfinishedItemCount: 3,
        receipt: receipt("not-a-date", 3),
        latestUnfinishedChangeAt: "2026-08-22T09:00:00.000Z",
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
        // Every unfinished item predates the capture, so the bundle covers them.
        latestBacklogChangeByStatus: async () => new Date("2026-08-22T09:30:00.000Z"),
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
        // Every unfinished item predates the capture, so the bundle covers them.
        latestBacklogChangeByStatus: async () => new Date("2026-08-22T09:30:00.000Z"),
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

  // BI-9CE1A6C8: the composed stance must require capture when the backlog has
  // SHRUNK since the capture but newer work is uncaptured. The count-based
  // predecessor returned "permitted" here.
  it("requires capture when the backlog shrank but holds work newer than the capture", async () => {
    const stance = await loadInstanceStance(
      store({
        readConfig: async (key) => {
          if (key === OPERATING_INTENT_CONFIG_KEY) return CONFIRMED_DEV_INTENT;
          if (key === BACKLOG_CAPTURE_CONFIG_KEY) {
            return {
              schemaVersion: 1,
              capturedAt: "2026-08-24T06:13:10.775Z",
              bundlePath: "/backups/backlog-captures/2026-08-24-pre-reinstall-final",
              itemCount: 69,
              unfinishedItemCount: 111,
            };
          }
          return null;
        },
        countBacklogItemsByStatus: async () => 98,
        latestBacklogChangeByStatus: async () => new Date("2026-08-25T23:44:00.000Z"),
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
    expect(stance.teardown).toBe("capture-required");
    expect(stance.holdsIrreplaceableWork).toBe(true);
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

  // The portal declaration is what an operator sets from the workspace panel.
  // These two cases are the proof that the panel changes what agents may do —
  // and that it cannot overrule the installer while doing so.
  it("honours a portal environment declaration when the installer declared nothing", async () => {
    const portalDeclaresDevelopment = {
      schemaVersion: 1,
      environmentClass: "development",
      declaredAt: "2026-08-22T12:00:00.000Z",
      declaredByPrincipalId: "PRN-1",
    };
    const stance = await loadInstanceStance(
      store({
        readConfig: async (key) => {
          if (key === OPERATING_INTENT_CONFIG_KEY) return CONFIRMED_DEV_INTENT;
          if (key === ENVIRONMENT_CLASS_CONFIG_KEY) return portalDeclaresDevelopment;
          return null;
        },
        countBacklogItemsByStatus: async () => 0,
      }),
      { readText: stateText(), env: {}, readHostProfile: consumerHost },
    );

    expect(stance.environmentClass).toBe("development");
    expect(stance.teardown).toBe("permitted");
    expect(stance.credentials).toBe("local-permitted");
  });

  it("keeps installer state above a portal declaration that disagrees", async () => {
    const stance = await loadInstanceStance(
      store({
        readConfig: async (key) => {
          if (key === OPERATING_INTENT_CONFIG_KEY) return CONFIRMED_DEV_INTENT;
          if (key === ENVIRONMENT_CLASS_CONFIG_KEY) {
            return {
              schemaVersion: 1,
              environmentClass: "development",
              declaredAt: "2026-08-22T12:00:00.000Z",
              declaredByPrincipalId: "PRN-1",
            };
          }
          return null;
        },
        countBacklogItemsByStatus: async () => 0,
      }),
      { readText: stateText("production"), env: {}, readHostProfile: consumerHost },
    );

    // A portal write must never be the reason a production install becomes
    // disposable.
    expect(stance.environmentClass).toBe("production");
    expect(stance.teardown).toBe("forbidden");
    expect(stance.credentials).toBe("operator-only");
  });
});
