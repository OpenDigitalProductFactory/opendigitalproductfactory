import {
  FEDERATION_RELATIONSHIP_PRESETS,
  type FederationRelationshipPreset,
} from "./federation-link-types";

export const INSTALLATION_OPERATING_PURPOSES = [
  "operate-organization",
  "evolve-dpf",
  "deliver-managed-services",
  "grow-channel",
  "participate-community",
] as const;

export type InstallationOperatingPurpose = (typeof INSTALLATION_OPERATING_PURPOSES)[number];

export const INSTALLATION_INTENT_EVIDENCE_SOURCES = [
  "installer",
  "organization",
  "business-context",
  "capability",
  "federation",
  "human",
] as const;

export type InstallationIntentEvidenceSource = (typeof INSTALLATION_INTENT_EVIDENCE_SOURCES)[number];
export type InstallationIntentConfidence = "high" | "medium" | "low";
export type InstallationIntentConfirmationStatus = "suggested" | "confirmed" | "needs-review";

export type InstallationOperatingIntentV1 = {
  schemaVersion: 1;
  primaryPurpose: InstallationOperatingPurpose;
  secondaryPurposes: InstallationOperatingPurpose[];
  relationshipIntents: FederationRelationshipPreset[];
  pairedProductionInstallationRef?: string;
  evidence: Array<{
    source: InstallationIntentEvidenceSource;
    claim: string;
    sourceRef?: string;
    valueFingerprint?: string;
    observedAt: string;
  }>;
  confidence: InstallationIntentConfidence;
  confirmation: {
    status: InstallationIntentConfirmationStatus;
    confirmedAt?: string;
    confirmedByPrincipalId?: string;
  };
};

export type InstallationOperatingIntentParseResult =
  | { ok: true; value: InstallationOperatingIntentV1 }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoDate(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function isPurpose(value: unknown): value is InstallationOperatingPurpose {
  return (INSTALLATION_OPERATING_PURPOSES as readonly unknown[]).includes(value);
}

function isRelationship(value: unknown): value is FederationRelationshipPreset {
  return (FEDERATION_RELATIONSHIP_PRESETS as readonly unknown[]).includes(value);
}

export function parseInstallationOperatingIntent(value: unknown): InstallationOperatingIntentParseResult {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    return { ok: false, error: "Unsupported or missing installation operating-intent schema version." };
  }
  if (!isPurpose(value.primaryPurpose)) {
    return { ok: false, error: "Installation primary purpose is not recognized." };
  }
  if (!Array.isArray(value.secondaryPurposes) || !value.secondaryPurposes.every(isPurpose)) {
    return { ok: false, error: "Installation secondary purposes are invalid." };
  }
  const purposeSet = new Set([value.primaryPurpose, ...value.secondaryPurposes]);
  if (purposeSet.size !== value.secondaryPurposes.length + 1) {
    return { ok: false, error: "Installation purposes must be unique." };
  }
  if (!Array.isArray(value.relationshipIntents) || !value.relationshipIntents.every(isRelationship)) {
    return { ok: false, error: "Installation relationship intent is not recognized." };
  }
  if (new Set(value.relationshipIntents).size !== value.relationshipIntents.length) {
    return { ok: false, error: "Installation relationship intents must be unique." };
  }
  if (value.pairedProductionInstallationRef !== undefined && !isNonEmptyString(value.pairedProductionInstallationRef)) {
    return { ok: false, error: "Paired production installation reference must be a non-empty string." };
  }
  if (!Array.isArray(value.evidence) || !value.evidence.every((entry) => {
    if (!isRecord(entry)) return false;
    return (INSTALLATION_INTENT_EVIDENCE_SOURCES as readonly unknown[]).includes(entry.source)
      && isNonEmptyString(entry.claim)
      && isIsoDate(entry.observedAt)
      && (entry.sourceRef === undefined || isNonEmptyString(entry.sourceRef))
      && (entry.valueFingerprint === undefined || isNonEmptyString(entry.valueFingerprint));
  })) {
    return { ok: false, error: "Installation intent evidence is invalid." };
  }
  if (value.confidence !== "high" && value.confidence !== "medium" && value.confidence !== "low") {
    return { ok: false, error: "Installation intent confidence is invalid." };
  }
  if (!isRecord(value.confirmation)
    || !["suggested", "confirmed", "needs-review"].includes(String(value.confirmation.status))) {
    return { ok: false, error: "Installation intent confirmation is invalid." };
  }
  if (value.confirmation.status === "confirmed"
    && (!isIsoDate(value.confirmation.confirmedAt) || !isNonEmptyString(value.confirmation.confirmedByPrincipalId))) {
    return { ok: false, error: "Confirmed installation intent requires confirmation provenance." };
  }

  return { ok: true, value: value as InstallationOperatingIntentV1 };
}
