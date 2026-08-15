import { describe, expect, it, vi } from "vitest";
import {
  absorbBootstrapIntent,
  deriveExistingInstallIntent,
  INSTALLATION_OPERATING_INTENT_KEY,
  loadInstallationOperatingIntent,
  resolveInvestmentFundingAuthority,
  saveInstallationOperatingIntent,
  type BootstrapIntentEnvelope,
  type InstallationIntentDb,
  type LoadedInstallationOperatingIntent,
} from "./operating-intent";
import type { InstallationOperatingIntentV1 } from "@dpf/db/installation-operating-intent";

describe("Installation Operating Intent Repository & Derivation (EP-1FABA22D / BI-A9F60372)", () => {
  const validIntent: InstallationOperatingIntentV1 = {
    schemaVersion: 1,
    primaryPurpose: "operate-organization",
    secondaryPurposes: ["participate-community"],
    relationshipIntents: ["same-organization"],
    evidence: [
      {
        source: "organization",
        claim: "Existing enterprise business",
        observedAt: "2026-08-08T12:00:00.000Z",
      },
    ],
    confidence: "high",
    confirmation: {
      status: "confirmed",
      confirmedAt: "2026-08-08T12:00:00.000Z",
      confirmedByPrincipalId: "usr-admin",
    },
  };

  describe("loadInstallationOperatingIntent", () => {
    it("returns missing when config key does not exist", async () => {
      const db: InstallationIntentDb = {
        platformConfig: {
          findUnique: vi.fn().mockResolvedValue(null),
          upsert: vi.fn(),
        },
      };

      const result = await loadInstallationOperatingIntent(db);
      expect(result).toEqual({ status: "missing" });
      expect(db.platformConfig.findUnique).toHaveBeenCalledWith({
        where: { key: INSTALLATION_OPERATING_INTENT_KEY },
        select: { value: true },
      });
    });

    it("returns valid when valid intent is stored", async () => {
      const db: InstallationIntentDb = {
        platformConfig: {
          findUnique: vi.fn().mockResolvedValue({ value: validIntent }),
          upsert: vi.fn(),
        },
      };

      const result = await loadInstallationOperatingIntent(db);
      expect(result).toEqual({ status: "valid", intent: validIntent });
    });

    it("returns invalid when config value is malformed", async () => {
      const db: InstallationIntentDb = {
        platformConfig: {
          findUnique: vi.fn().mockResolvedValue({ value: { schemaVersion: 99 } }),
          upsert: vi.fn(),
        },
      };

      const result = await loadInstallationOperatingIntent(db);
      expect(result.status).toBe("invalid");
    });
  });

  describe("saveInstallationOperatingIntent", () => {
    it("validates and upserts intent", async () => {
      const upsertMock = vi.fn().mockResolvedValue({});
      const db: InstallationIntentDb = {
        platformConfig: {
          findUnique: vi.fn(),
          upsert: upsertMock,
        },
      };

      const result = await saveInstallationOperatingIntent(db, validIntent);
      expect(result.ok).toBe(true);
      expect(upsertMock).toHaveBeenCalledWith({
        where: { key: INSTALLATION_OPERATING_INTENT_KEY },
        update: { value: validIntent },
        create: {
          key: INSTALLATION_OPERATING_INTENT_KEY,
          value: validIntent,
        },
      });
    });

    it("refuses invalid intent without saving", async () => {
      const upsertMock = vi.fn();
      const db: InstallationIntentDb = {
        platformConfig: {
          findUnique: vi.fn(),
          upsert: upsertMock,
        },
      };

      const invalid = { ...validIntent, primaryPurpose: "invalid" as any };
      const result = await saveInstallationOperatingIntent(db, invalid);
      expect(result.ok).toBe(false);
      expect(upsertMock).not.toHaveBeenCalled();
    });
  });

  describe("deriveExistingInstallIntent", () => {
    it("derives evolve-dpf when running in development environment", async () => {
      const db: InstallationIntentDb = {
        platformConfig: { findUnique: vi.fn(), upsert: vi.fn() },
      };

      const derived = await deriveExistingInstallIntent(db, {
        environmentClass: "development",
        isDevWorkspace: true,
      });

      expect(derived.primaryPurpose).toBe("evolve-dpf");
      expect(derived.confidence).toBe("high");
      expect(derived.confirmation.status).toBe("suggested");
      expect(derived.evidence.length).toBeGreaterThan(0);
    });

    it("derives operate-organization when organization is present in production", async () => {
      const db: InstallationIntentDb = {
        platformConfig: { findUnique: vi.fn(), upsert: vi.fn() },
        organization: {
          findFirst: vi.fn().mockResolvedValue({ id: "org-1", name: "Acme Corp" }),
        },
        businessContext: {
          findFirst: vi.fn().mockResolvedValue({ id: "bc-1", mission: "Serve clients" }),
        },
      };

      const derived = await deriveExistingInstallIntent(db, {
        environmentClass: "production",
        isDevWorkspace: false,
      });

      expect(derived.primaryPurpose).toBe("operate-organization");
      expect(derived.confidence).toBe("high");
      expect(derived.confirmation.status).toBe("suggested");
      expect(derived.evidence.some((e) => e.source === "organization")).toBe(true);
      expect(derived.evidence.some((e) => e.source === "business-context")).toBe(true);
    });

    it("derives deliver-managed-services when service-provider link exists", async () => {
      const db: InstallationIntentDb = {
        platformConfig: { findUnique: vi.fn(), upsert: vi.fn() },
        federationLink: {
          findMany: vi.fn().mockResolvedValue([{ id: "link-1", preset: "service-provider" }]),
        },
      };

      const derived = await deriveExistingInstallIntent(db, {
        environmentClass: "production",
        isDevWorkspace: false,
      });

      expect(derived.primaryPurpose).toBe("deliver-managed-services");
      expect(derived.relationshipIntents).toContain("service-provider");
      expect(derived.confirmation.status).toBe("suggested");
    });
  });

  describe("absorbBootstrapIntent", () => {
    it("absorbs unabsorbed bootstrap intent into PlatformConfig", async () => {
      const upsertMock = vi.fn().mockResolvedValue({});
      const db: InstallationIntentDb = {
        platformConfig: {
          findUnique: vi.fn().mockResolvedValue(null),
          upsert: upsertMock,
        },
      };

      const bootstrap: BootstrapIntentEnvelope = {
        schemaVersion: 1,
        primaryPurpose: "operate-organization",
        secondaryPurposes: ["grow-channel"],
        relationshipIntents: ["channel"],
        confidence: "high",
        recordedAt: "2026-08-08T10:00:00.000Z",
        absorbedAt: null,
      };

      const result = await absorbBootstrapIntent(db, bootstrap);
      expect(result.absorbed).toBe(true);
      expect(result.intent?.primaryPurpose).toBe("operate-organization");
      expect(result.intent?.secondaryPurposes).toEqual(["grow-channel"]);
      expect(result.intent?.confirmation.status).toBe("suggested");
      expect(upsertMock).toHaveBeenCalled();
    });

    it("does not overwrite already-confirmed intent", async () => {
      const upsertMock = vi.fn();
      const db: InstallationIntentDb = {
        platformConfig: {
          findUnique: vi.fn().mockResolvedValue({ value: validIntent }),
          upsert: upsertMock,
        },
      };

      const bootstrap: BootstrapIntentEnvelope = {
        schemaVersion: 1,
        primaryPurpose: "deliver-managed-services",
        confidence: "high",
        recordedAt: "2026-08-08T10:00:00.000Z",
      };

      const result = await absorbBootstrapIntent(db, bootstrap);
      expect(result.absorbed).toBe(false);
      expect(result.intent?.primaryPurpose).toBe("operate-organization");
      expect(upsertMock).not.toHaveBeenCalled();
    });
  });

  describe("resolveInvestmentFundingAuthority", () => {
    it("allows confirmed operate-organization install", () => {
      const loaded: LoadedInstallationOperatingIntent = {
        status: "valid",
        intent: validIntent,
      };
      expect(resolveInvestmentFundingAuthority(loaded)).toEqual({ allowed: true });
    });

    it("refuses unconfirmed install", () => {
      const loaded: LoadedInstallationOperatingIntent = {
        status: "valid",
        intent: {
          ...validIntent,
          confirmation: { status: "suggested" },
        },
      };
      const result = resolveInvestmentFundingAuthority(loaded);
      expect(result.allowed).toBe(false);
    });

    it("refuses missing install intent", () => {
      expect(resolveInvestmentFundingAuthority({ status: "missing" }).allowed).toBe(false);
    });
  });
});
