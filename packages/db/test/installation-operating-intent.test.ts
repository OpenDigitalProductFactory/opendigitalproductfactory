import { describe, expect, it } from "vitest";
import {
  computeProfileFingerprint,
  INSTALLATION_ENVIRONMENT_CLASSES,
  INSTALLATION_EVIDENCE_SOURCES,
  INSTALLATION_INTENT_CONFIDENCE_LEVELS,
  INSTALLATION_INTENT_CONFIRMATION_STATUSES,
  INSTALLATION_OPERATING_PURPOSES,
  isInstallationEnvironmentClass,
  isInstallationEvidenceSource,
  isInstallationIntentConfidence,
  isInstallationIntentConfirmationStatus,
  isInstallationOperatingPurpose,
  parseOperatingIntent,
  validateOperatingIntent,
  type InstallationOperatingIntentV1,
  type InstallationOperatingProfileSnapshot,
} from "../src/installation-operating-intent";

describe("Installation Operating Intent Contract (EP-1FABA22D / BI-A9F60372)", () => {
  it("maintains closed purpose and environment sets", () => {
    expect(INSTALLATION_OPERATING_PURPOSES).toEqual([
      "operate-organization",
      "evolve-dpf",
      "deliver-managed-services",
      "grow-channel",
      "participate-community",
    ]);

    expect(INSTALLATION_ENVIRONMENT_CLASSES).toEqual([
      "production",
      "development",
      "test",
    ]);

    expect(INSTALLATION_INTENT_CONFIRMATION_STATUSES).toEqual([
      "suggested",
      "confirmed",
      "needs-review",
    ]);

    expect(INSTALLATION_EVIDENCE_SOURCES).toEqual([
      "installer",
      "organization",
      "business-context",
      "capability",
      "federation",
      "human",
    ]);

    expect(INSTALLATION_INTENT_CONFIDENCE_LEVELS).toEqual(["high", "medium", "low"]);
  });

  it("evaluates type guards correctly", () => {
    expect(isInstallationOperatingPurpose("operate-organization")).toBe(true);
    expect(isInstallationOperatingPurpose("invalid-purpose")).toBe(false);
    expect(isInstallationOperatingPurpose(null)).toBe(false);

    expect(isInstallationEnvironmentClass("production")).toBe(true);
    expect(isInstallationEnvironmentClass("staging")).toBe(false);

    expect(isInstallationIntentConfirmationStatus("confirmed")).toBe(true);
    expect(isInstallationIntentConfirmationStatus("pending")).toBe(false);

    expect(isInstallationEvidenceSource("installer")).toBe(true);
    expect(isInstallationEvidenceSource("unknown")).toBe(false);

    expect(isInstallationIntentConfidence("high")).toBe(true);
    expect(isInstallationIntentConfidence("critical")).toBe(false);
  });

  const validIntent: InstallationOperatingIntentV1 = {
    schemaVersion: 1,
    primaryPurpose: "operate-organization",
    secondaryPurposes: ["participate-community"],
    relationshipIntents: ["same-organization", "service-provider"],
    pairedProductionInstallationRef: "inst-prod-001",
    evidence: [
      {
        source: "installer",
        claim: "Installer created dedicated production container topology",
        sourceRef: "install-state.v2",
        valueFingerprint: "sha256:abcd",
        observedAt: "2026-08-08T12:00:00.000Z",
      },
      {
        source: "organization",
        claim: "Organization industry is healthcare-wellness",
        sourceRef: "org-1",
        observedAt: "2026-08-08T12:05:00.000Z",
      },
    ],
    confidence: "high",
    confirmation: {
      status: "confirmed",
      confirmedAt: "2026-08-08T12:10:00.000Z",
      confirmedByPrincipalId: "princ-admin-1",
    },
  };

  it("validates a well-formed operating intent", () => {
    const result = validateOperatingIntent(validIntent);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.data).toEqual(validIntent);

    const parsed = parseOperatingIntent(validIntent);
    expect(parsed).toEqual(validIntent);
  });

  it("rejects non-object or null input", () => {
    expect(validateOperatingIntent(null).valid).toBe(false);
    expect(validateOperatingIntent("string").valid).toBe(false);
    expect(validateOperatingIntent([]).valid).toBe(false);
    expect(parseOperatingIntent(null)).toBeNull();
  });

  it("rejects unsupported schema versions", () => {
    const invalid = { ...validIntent, schemaVersion: 2 };
    const result = validateOperatingIntent(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("schemaVersion"))).toBe(true);
  });

  it("rejects invalid primary purpose", () => {
    const invalid = { ...validIntent, primaryPurpose: "run-everything" };
    const result = validateOperatingIntent(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("primaryPurpose"))).toBe(true);
  });

  it("rejects secondary purpose when it duplicates primary purpose or itself", () => {
    const dupPrimary = {
      ...validIntent,
      secondaryPurposes: ["operate-organization"],
    };
    expect(validateOperatingIntent(dupPrimary).valid).toBe(false);

    const dupSelf = {
      ...validIntent,
      secondaryPurposes: ["evolve-dpf", "evolve-dpf"],
    };
    expect(validateOperatingIntent(dupSelf).valid).toBe(false);
  });

  it("rejects invalid or duplicate relationship intents", () => {
    const invalidPreset = {
      ...validIntent,
      relationshipIntents: ["untrusted-peer"],
    };
    expect(validateOperatingIntent(invalidPreset).valid).toBe(false);

    const duplicatePreset = {
      ...validIntent,
      relationshipIntents: ["same-organization", "same-organization"],
    };
    expect(validateOperatingIntent(duplicatePreset).valid).toBe(false);
  });

  it("rejects malformed evidence items", () => {
    const emptyClaim = {
      ...validIntent,
      evidence: [
        {
          source: "installer",
          claim: "   ",
          observedAt: "2026-08-08T12:00:00.000Z",
        },
      ],
    };
    expect(validateOperatingIntent(emptyClaim).valid).toBe(false);

    const invalidDate = {
      ...validIntent,
      evidence: [
        {
          source: "installer",
          claim: "valid claim",
          observedAt: "not-a-date",
        },
      ],
    };
    expect(validateOperatingIntent(invalidDate).valid).toBe(false);
  });

  it("rejects invalid confirmation dates or statuses", () => {
    const invalidStatus = {
      ...validIntent,
      confirmation: {
        status: "auto-approved",
      },
    };
    expect(validateOperatingIntent(invalidStatus).valid).toBe(false);

    const invalidDate = {
      ...validIntent,
      confirmation: {
        status: "confirmed",
        confirmedAt: "invalid-time",
      },
    };
    expect(validateOperatingIntent(invalidDate).valid).toBe(false);
  });

  describe("computeProfileFingerprint", () => {
    const baseSnapshot: Omit<InstallationOperatingProfileSnapshot, "profileFingerprint"> = {
      schemaVersion: 1,
      environmentClass: "production",
      primaryPurpose: "operate-organization",
      secondaryPurposes: ["participate-community", "deliver-managed-services"],
      relationshipIntents: ["service-provider", "same-organization"],
      pairedProductionInstallationRef: "prod-ref",
      confidence: "high",
      confirmationStatus: "confirmed",
      confirmedAt: "2026-08-08T12:00:00.000Z",
      confirmedByPrincipalId: "princ-1",
      evidence: [
        {
          source: "installer",
          claim: "Host has 64GB RAM",
          sourceRef: "install-state",
          observedAt: "2026-08-08T12:00:00.000Z",
        },
        {
          source: "organization",
          claim: "Verified commercial domain",
          observedAt: "2026-08-08T12:01:00.000Z",
        },
      ],
    };

    it("is deterministic and order-invariant for array facts", () => {
      const fp1 = computeProfileFingerprint(baseSnapshot);
      expect(typeof fp1).toBe("string");
      expect(fp1).toHaveLength(64);

      // Reordered arrays & different timestamp (timestamp is excluded from fingerprint)
      const reordered: Omit<InstallationOperatingProfileSnapshot, "profileFingerprint"> = {
        ...baseSnapshot,
        confirmedAt: "2026-08-15T00:00:00.000Z",
        secondaryPurposes: ["deliver-managed-services", "participate-community"],
        relationshipIntents: ["same-organization", "service-provider"],
        evidence: [baseSnapshot.evidence[1], baseSnapshot.evidence[0]],
      };

      const fp2 = computeProfileFingerprint(reordered);
      expect(fp2).toBe(fp1);
    });

    it("changes when substantive facts differ", () => {
      const fpBase = computeProfileFingerprint(baseSnapshot);

      const differentEnv = computeProfileFingerprint({
        ...baseSnapshot,
        environmentClass: "development",
      });
      expect(differentEnv).not.toBe(fpBase);

      const differentPurpose = computeProfileFingerprint({
        ...baseSnapshot,
        primaryPurpose: "evolve-dpf",
      });
      expect(differentPurpose).not.toBe(fpBase);

      const differentConfirmation = computeProfileFingerprint({
        ...baseSnapshot,
        confirmationStatus: "suggested",
      });
      expect(differentConfirmation).not.toBe(fpBase);
    });
  });
});
