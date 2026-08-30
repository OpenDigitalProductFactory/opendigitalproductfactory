import { describe, expect, it } from "vitest";

import { readLocalCiInstallationProfile } from "./local-ci-capacity-profile";
import {
  deriveLocalCiCapacityFromInstallation,
  derivedLocalCiPoolConfig,
  localCiHostStageAdmissionReserveBytes,
  localCiHostStageHeadroomCapacity,
  localCiPoolConfigError,
  resolveLocalCiPoolPolicy,
} from "./local-ci-pool-policy";
import localCiSlotResources from "./local-ci-slot-resources.json" with {
  type: "json",
};

const GiB = 1024 ** 3;

/** This host, measured 2026-08-29. */
const measuredHost = {
  dockerAvailableMemoryBytes: 21707272 * 1024,
  availableMemoryBytes: Math.round(16.9 * GiB),
  builderMemoryUsageBytes: [0, 0],
  sustainedCpuPercent: 8.6,
  diskFreeBytes: 400 * GiB,
  observedAt: new Date().toISOString(),
  dockerHealthy: true,
  convergenceActive: false,
  fencesHealthy: true,
  evidenceIsolationHealthy: true,
};

const operatorRow = {
  version: 1,
  requestedCapacity: 1,
  ceilings: {
    minAvailableMemoryBytes: 4 * GiB,
    maxSustainedCpuPercent: 85,
    minDiskFreeBytes: 50 * GiB,
  },
  rollback: {
    maxServiceDurationRegressionPercent: 15,
    maxInfrastructureFailureRatePercent: 5,
    evidenceMismatchTolerance: 0,
  },
};

describe("deriveLocalCiCapacityFromInstallation", () => {
  it("gives a development platform-build installation the second slot", () => {
    expect(
      deriveLocalCiCapacityFromInstallation({
        environmentClass: "development",
        primaryPurpose: "evolve-dpf",
      }),
    ).toEqual({
      requestedCapacity: 2,
      reason: "installation-development-platform-build",
    });
  });

  it("counts evolve-dpf as a secondary purpose", () => {
    expect(
      deriveLocalCiCapacityFromInstallation({
        environmentClass: "development",
        primaryPurpose: "operate-organization",
        secondaryPurposes: ["evolve-dpf"],
      })?.requestedCapacity,
    ).toBe(2);
  });

  it("keeps every production installation at one slot", () => {
    const derived = deriveLocalCiCapacityFromInstallation({
      environmentClass: "production",
      primaryPurpose: "evolve-dpf",
    });
    expect(derived?.requestedCapacity).toBe(1);
    expect(derived?.reason).toBe("installation-environment-class-production");
  });

  it("keeps a development installation that runs a business at one slot", () => {
    const derived = deriveLocalCiCapacityFromInstallation({
      environmentClass: "development",
      primaryPurpose: "operate-organization",
    });
    expect(derived?.requestedCapacity).toBe(1);
    expect(derived?.reason).toBe("installation-purpose-operate-organization");
  });

  it("declines to decide for an undeclared installation", () => {
    expect(deriveLocalCiCapacityFromInstallation(null)).toBeNull();
    expect(deriveLocalCiCapacityFromInstallation(undefined)).toBeNull();
  });
});

describe("derivedLocalCiPoolConfig", () => {
  it("produces a config the operator-row validator accepts", () => {
    // A derived config must never be looser than a row an operator is allowed
    // to write, so it has to survive the same validator.
    expect(localCiPoolConfigError(derivedLocalCiPoolConfig(2))).toBeNull();
    expect(localCiPoolConfigError(derivedLocalCiPoolConfig(1))).toBeNull();
  });
});

describe("localCiHostStageAdmissionReserveBytes", () => {
  it("reserves the calibrated figure, not the hard ceiling", () => {
    expect(
      localCiHostStageAdmissionReserveBytes({
        hardCeilingBytes: localCiSlotResources.hostStagePolicy.memoryBytes,
        calibratedReserveBytes:
          localCiSlotResources.hostStagePolicy.admissionReserveBytes,
      }),
    ).toBe(6 * GiB);
  });

  it("falls back to the ceiling when calibration is missing or invalid", () => {
    for (const calibratedReserveBytes of [0, -1, Number.NaN]) {
      expect(
        localCiHostStageAdmissionReserveBytes({
          hardCeilingBytes: 8 * GiB,
          calibratedReserveBytes,
        }),
      ).toBe(8 * GiB);
    }
  });

  it("never reserves more than the hard ceiling", () => {
    expect(
      localCiHostStageAdmissionReserveBytes({
        hardCeilingBytes: 8 * GiB,
        calibratedReserveBytes: 99 * GiB,
      }),
    ).toBe(8 * GiB);
  });

  it("admits two host stages on the measured host, where 8 GiB admitted one", () => {
    const shared = {
      availableMemoryBytes: Math.round(16.9 * GiB),
      minAvailableMemoryBytes: 4 * GiB,
      manifestCapacity: 2,
    };
    expect(
      localCiHostStageHeadroomCapacity({
        ...shared,
        hostStageMemoryBytes: 8 * GiB,
      }),
    ).toBe(1);
    expect(
      localCiHostStageHeadroomCapacity({
        ...shared,
        hostStageMemoryBytes: 6 * GiB,
      }),
    ).toBe(2);
  });
});

describe("resolveLocalCiPoolPolicy with a derived installation profile", () => {
  const resolve = (installation: unknown, configValue: unknown = null) =>
    resolveLocalCiPoolPolicy({
      configValue,
      host: measuredHost,
      manifestSlotCount: 2,
      reserveAdmissionHeadroom: true,
      installation: installation as never,
    });

  it("admits two slots on a development platform-build host with no config row", () => {
    const policy = resolve({
      environmentClass: "development",
      primaryPurpose: "evolve-dpf",
    });
    expect(policy.effectiveCapacity).toBe(2);
    expect(policy.source).toBe("installation-profile");
    expect(policy.rollbackReason).toBeNull();
    expect(policy.slotKeys).toEqual(["slot-0", "slot-1"]);
  });

  it("keeps a consumer installation at one slot and says why", () => {
    const policy = resolve({
      environmentClass: "production",
      primaryPurpose: "operate-organization",
    });
    expect(policy.effectiveCapacity).toBe(1);
    expect(policy.source).toBe("installation-profile");
    expect(policy.rollbackReason).toBe(
      "installation-environment-class-production",
    );
  });

  it("keeps the compatibility singleton when nothing is declared", () => {
    const policy = resolve(null);
    expect(policy.effectiveCapacity).toBe(1);
    expect(policy.source).toBe("default");
    expect(policy.rollbackReason).toBe("config-absent");
  });

  it("lets an explicit operator row beat the derived default", () => {
    const policy = resolve(
      { environmentClass: "development", primaryPurpose: "evolve-dpf" },
      operatorRow,
    );
    expect(policy.effectiveCapacity).toBe(1);
    expect(policy.source).toBe("platform-config");
    expect(policy.rollbackReason).toBe("requested-singleton");
  });

  it("clamps a derived capacity down to one when the host carries only one stage", () => {
    // floor((12 - 4) / 6) === 1
    const policy = resolveLocalCiPoolPolicy({
      configValue: null,
      host: { ...measuredHost, availableMemoryBytes: 12 * GiB },
      manifestSlotCount: 2,
      reserveAdmissionHeadroom: true,
      installation: {
        environmentClass: "development",
        primaryPurpose: "evolve-dpf",
      },
    });
    expect(policy.effectiveCapacity).toBe(1);
    expect(policy.rollbackReason).toBe("host-stage-capacity-one");
  });

  it("closes admission entirely when the host carries no stage at all", () => {
    // floor((6 - 4) / 6) === 0. Zero headroom shuts the gate rather than
    // degrading to one, which is the documented host-pressure behaviour.
    const policy = resolveLocalCiPoolPolicy({
      configValue: null,
      host: { ...measuredHost, availableMemoryBytes: 6 * GiB },
      manifestSlotCount: 2,
      reserveAdmissionHeadroom: true,
      installation: {
        environmentClass: "development",
        primaryPurpose: "evolve-dpf",
      },
    });
    expect(policy.effectiveCapacity).toBe(0);
    expect(policy.rollbackReason).toBe("host-stage-headroom-low");
  });

  it("still refuses to admit on an unsafe host", () => {
    const policy = resolveLocalCiPoolPolicy({
      configValue: null,
      host: { ...measuredHost, dockerHealthy: false },
      manifestSlotCount: 2,
      reserveAdmissionHeadroom: true,
      installation: {
        environmentClass: "development",
        primaryPurpose: "evolve-dpf",
      },
    });
    expect(policy.effectiveCapacity).toBe(0);
    expect(policy.rollbackReason).toBe("docker-unhealthy");
  });
});

describe("readLocalCiInstallationProfile", () => {
  const reader = (rows: Record<string, unknown>) => ({
    findUnique: async ({ where }: { where: { key: string } }) =>
      where.key in rows ? { value: rows[where.key] } : null,
  });

  const declared = {
    "installation.environment-class.v1": {
      schemaVersion: 1,
      environmentClass: "development",
      declaredAt: "2026-08-24T00:54:48.215Z",
    },
    // Mirrors the live row on this installation, read 2026-08-29.
    "installation.operating-intent.v1": {
      schemaVersion: 1,
      primaryPurpose: "evolve-dpf",
      secondaryPurposes: [],
      relationshipIntents: [],
      confidence: "high",
      confirmation: {
        status: "confirmed",
        confirmedAt: "2026-08-24T00:54:48.215Z",
        confirmedByPrincipalId: "PRN-e0056320-5341-49a8-acfe-3be6eddb6c54",
      },
      evidence: [
        {
          claim: "The operator declared this installation: evolve-dpf in development.",
          source: "human",
          observedAt: "2026-08-24T00:54:48.215Z",
        },
      ],
    },
  };

  it("reads a fully declared installation", async () => {
    const profile = await readLocalCiInstallationProfile({
      platformConfig: reader(declared) as never,
    });
    expect(profile?.environmentClass).toBe("development");
    expect(profile?.primaryPurpose).toBe("evolve-dpf");
  });

  it("returns null when either declaration is absent", async () => {
    for (const key of Object.keys(declared)) {
      const partial = { ...declared };
      delete (partial as Record<string, unknown>)[key];
      expect(
        await readLocalCiInstallationProfile({
          platformConfig: reader(partial) as never,
        }),
      ).toBeNull();
    }
  });

  it("returns null on a malformed declaration rather than guessing", async () => {
    expect(
      await readLocalCiInstallationProfile({
        platformConfig: reader({
          ...declared,
          "installation.environment-class.v1": { environmentClass: "staging" },
        }) as never,
      }),
    ).toBeNull();
  });
});
