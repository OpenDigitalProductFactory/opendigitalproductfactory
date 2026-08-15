// EP-1FABA22D · Purpose-Aware Installation and Ecosystem Productivity (BI-A9F60372)
// Pure TypeScript types, validator, and projection helpers for the installation operating intent.
// Single source of truth for operating purpose, environment class, and profile snapshot contracts.

import { createHash } from "crypto";
import {
  FEDERATION_RELATIONSHIP_PRESETS,
  isFederationRelationshipPreset,
  type FederationRelationshipPreset,
} from "./federation-link-types";

/** Canonical installation operating purposes */
export const INSTALLATION_OPERATING_PURPOSES = [
  "operate-organization",
  "evolve-dpf",
  "deliver-managed-services",
  "grow-channel",
  "participate-community",
] as const;
export type InstallationOperatingPurpose = (typeof INSTALLATION_OPERATING_PURPOSES)[number];

/** Canonical environment classes (converged with federation vocabulary) */
export const INSTALLATION_ENVIRONMENT_CLASSES = [
  "production",
  "development",
  "test",
] as const;
export type InstallationEnvironmentClass = (typeof INSTALLATION_ENVIRONMENT_CLASSES)[number];

/** Confirmation status for the intent */
export const INSTALLATION_INTENT_CONFIRMATION_STATUSES = [
  "suggested",
  "confirmed",
  "needs-review",
] as const;
export type InstallationIntentConfirmationStatus = (typeof INSTALLATION_INTENT_CONFIRMATION_STATUSES)[number];

/** Admissible sources for intent derivation evidence */
export const INSTALLATION_EVIDENCE_SOURCES = [
  "installer",
  "organization",
  "business-context",
  "capability",
  "federation",
  "human",
] as const;
export type InstallationEvidenceSource = (typeof INSTALLATION_EVIDENCE_SOURCES)[number];

/** Intent confidence levels */
export const INSTALLATION_INTENT_CONFIDENCE_LEVELS = [
  "high",
  "medium",
  "low",
] as const;
export type InstallationIntentConfidence = (typeof INSTALLATION_INTENT_CONFIDENCE_LEVELS)[number];

/** Privacy-safe evidence descriptor for intent derivation */
export interface InstallationOperatingIntentEvidence {
  source: InstallationEvidenceSource;
  claim: string;
  sourceRef?: string;
  valueFingerprint?: string;
  observedAt: string;
}

/** Stored semantic operating intent in PlatformConfig key `installation.operating-intent.v1` */
export interface InstallationOperatingIntentV1 {
  schemaVersion: 1;
  primaryPurpose: InstallationOperatingPurpose;
  secondaryPurposes: InstallationOperatingPurpose[];
  relationshipIntents: FederationRelationshipPreset[];
  pairedProductionInstallationRef?: string;
  evidence: InstallationOperatingIntentEvidence[];
  confidence: InstallationIntentConfidence;
  confirmation: {
    status: InstallationIntentConfirmationStatus;
    confirmedAt?: string;
    confirmedByPrincipalId?: string;
  };
}

/** Read-time derived snapshot of the installation operating profile */
export interface InstallationOperatingProfileSnapshot {
  schemaVersion: 1;
  profileFingerprint: string;
  environmentClass: InstallationEnvironmentClass;
  primaryPurpose: InstallationOperatingPurpose;
  secondaryPurposes: InstallationOperatingPurpose[];
  relationshipIntents: FederationRelationshipPreset[];
  pairedProductionInstallationRef?: string;
  confidence: InstallationIntentConfidence;
  confirmationStatus: InstallationIntentConfirmationStatus;
  confirmedAt?: string;
  confirmedByPrincipalId?: string;
  evidence: InstallationOperatingIntentEvidence[];
}

export function isInstallationOperatingPurpose(value: unknown): value is InstallationOperatingPurpose {
  return typeof value === "string" && (INSTALLATION_OPERATING_PURPOSES as readonly string[]).includes(value);
}

export function isInstallationEnvironmentClass(value: unknown): value is InstallationEnvironmentClass {
  return typeof value === "string" && (INSTALLATION_ENVIRONMENT_CLASSES as readonly string[]).includes(value);
}

export function isInstallationIntentConfirmationStatus(value: unknown): value is InstallationIntentConfirmationStatus {
  return typeof value === "string" && (INSTALLATION_INTENT_CONFIRMATION_STATUSES as readonly string[]).includes(value);
}

export function isInstallationEvidenceSource(value: unknown): value is InstallationEvidenceSource {
  return typeof value === "string" && (INSTALLATION_EVIDENCE_SOURCES as readonly string[]).includes(value);
}

export function isInstallationIntentConfidence(value: unknown): value is InstallationIntentConfidence {
  return typeof value === "string" && (INSTALLATION_INTENT_CONFIDENCE_LEVELS as readonly string[]).includes(value);
}

export interface IntentValidationResult {
  valid: boolean;
  errors: string[];
  data?: InstallationOperatingIntentV1;
}

/**
 * Validates raw data against the InstallationOperatingIntentV1 schema.
 * Rejects unknown schema versions, invalid enums, and duplicate purposes.
 */
export function validateOperatingIntent(raw: unknown): IntentValidationResult {
  const errors: string[] = [];

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, errors: ["Operating intent must be a non-null object"] };
  }

  const obj = raw as Record<string, unknown>;

  if (obj.schemaVersion !== 1) {
    errors.push(`Unsupported or missing schemaVersion: ${String(obj.schemaVersion)} (expected 1)`);
  }

  if (!isInstallationOperatingPurpose(obj.primaryPurpose)) {
    errors.push(`Invalid primaryPurpose: ${String(obj.primaryPurpose)}`);
  }

  const secondaryPurposes: InstallationOperatingPurpose[] = [];
  if (!Array.isArray(obj.secondaryPurposes)) {
    errors.push("secondaryPurposes must be an array");
  } else {
    const seen = new Set<string>();
    for (const item of obj.secondaryPurposes) {
      if (!isInstallationOperatingPurpose(item)) {
        errors.push(`Invalid secondaryPurpose: ${String(item)}`);
      } else if (seen.has(item)) {
        errors.push(`Duplicate secondaryPurpose: ${item}`);
      } else if (item === obj.primaryPurpose) {
        errors.push(`secondaryPurpose cannot duplicate primaryPurpose: ${item}`);
      } else {
        seen.add(item);
        secondaryPurposes.push(item);
      }
    }
  }

  const relationshipIntents: FederationRelationshipPreset[] = [];
  if (!Array.isArray(obj.relationshipIntents)) {
    errors.push("relationshipIntents must be an array");
  } else {
    const seenPresets = new Set<string>();
    for (const item of obj.relationshipIntents) {
      if (typeof item !== "string" || !isFederationRelationshipPreset(item)) {
        errors.push(`Invalid relationshipIntent: ${String(item)}`);
      } else if (seenPresets.has(item)) {
        errors.push(`Duplicate relationshipIntent: ${item}`);
      } else {
        seenPresets.add(item);
        relationshipIntents.push(item);
      }
    }
  }

  if (
    obj.pairedProductionInstallationRef !== undefined &&
    typeof obj.pairedProductionInstallationRef !== "string"
  ) {
    errors.push("pairedProductionInstallationRef must be a string if provided");
  }

  const evidence: InstallationOperatingIntentEvidence[] = [];
  if (!Array.isArray(obj.evidence)) {
    errors.push("evidence must be an array");
  } else {
    for (let i = 0; i < obj.evidence.length; i++) {
      const ev = obj.evidence[i];
      if (!ev || typeof ev !== "object" || Array.isArray(ev)) {
        errors.push(`evidence[${i}] must be an object`);
        continue;
      }
      const evObj = ev as Record<string, unknown>;
      if (!isInstallationEvidenceSource(evObj.source)) {
        errors.push(`evidence[${i}].source is invalid: ${String(evObj.source)}`);
      }
      if (typeof evObj.claim !== "string" || evObj.claim.trim().length === 0) {
        errors.push(`evidence[${i}].claim must be a non-empty string`);
      }
      if (evObj.sourceRef !== undefined && typeof evObj.sourceRef !== "string") {
        errors.push(`evidence[${i}].sourceRef must be a string`);
      }
      if (evObj.valueFingerprint !== undefined && typeof evObj.valueFingerprint !== "string") {
        errors.push(`evidence[${i}].valueFingerprint must be a string`);
      }
      if (typeof evObj.observedAt !== "string" || Number.isNaN(Date.parse(evObj.observedAt))) {
        errors.push(`evidence[${i}].observedAt must be a valid ISO date string`);
      }
      if (errors.length === 0) {
        evidence.push({
          source: evObj.source as InstallationEvidenceSource,
          claim: String(evObj.claim),
          sourceRef: evObj.sourceRef as string | undefined,
          valueFingerprint: evObj.valueFingerprint as string | undefined,
          observedAt: String(evObj.observedAt),
        });
      }
    }
  }

  if (!isInstallationIntentConfidence(obj.confidence)) {
    errors.push(`Invalid confidence level: ${String(obj.confidence)}`);
  }

  if (!obj.confirmation || typeof obj.confirmation !== "object" || Array.isArray(obj.confirmation)) {
    errors.push("confirmation must be an object");
  } else {
    const conf = obj.confirmation as Record<string, unknown>;
    if (!isInstallationIntentConfirmationStatus(conf.status)) {
      errors.push(`Invalid confirmation.status: ${String(conf.status)}`);
    }
    if (conf.confirmedAt !== undefined) {
      if (typeof conf.confirmedAt !== "string" || Number.isNaN(Date.parse(conf.confirmedAt))) {
        errors.push("confirmation.confirmedAt must be a valid ISO date string");
      }
    }
    if (conf.confirmedByPrincipalId !== undefined && typeof conf.confirmedByPrincipalId !== "string") {
      errors.push("confirmation.confirmedByPrincipalId must be a string");
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const conf = obj.confirmation as Record<string, unknown>;
  const validatedData: InstallationOperatingIntentV1 = {
    schemaVersion: 1,
    primaryPurpose: obj.primaryPurpose as InstallationOperatingPurpose,
    secondaryPurposes,
    relationshipIntents,
    pairedProductionInstallationRef: obj.pairedProductionInstallationRef as string | undefined,
    evidence,
    confidence: obj.confidence as InstallationIntentConfidence,
    confirmation: {
      status: conf.status as InstallationIntentConfirmationStatus,
      confirmedAt: conf.confirmedAt as string | undefined,
      confirmedByPrincipalId: conf.confirmedByPrincipalId as string | undefined,
    },
  };

  return { valid: true, errors: [], data: validatedData };
}

export type ParseInstallationOperatingIntentResult =
  | { ok: true; value: InstallationOperatingIntentV1 }
  | { ok: false; error: string };

/**
 * Parses and validates an operating intent. Returns structured result with ok: true/false.
 */
export function parseInstallationOperatingIntent(raw: unknown): ParseInstallationOperatingIntentResult {
  const result = validateOperatingIntent(raw);
  if (result.valid && result.data) {
    return { ok: true, value: result.data };
  }
  return { ok: false, error: result.errors.join("; ") || "Invalid operating intent" };
}

/**
 * Safely parses and validates an operating intent. Returns null if corrupt or invalid.
 */
export function parseOperatingIntent(raw: unknown): InstallationOperatingIntentV1 | null {
  const result = validateOperatingIntent(raw);
  return result.valid && result.data ? result.data : null;
}

/**
 * Computes a deterministic sha256 profile fingerprint over stable semantic facts.
 * Volatile timestamps and mutable display copy are excluded.
 */
export function computeProfileFingerprint(
  input: Omit<InstallationOperatingProfileSnapshot, "profileFingerprint">
): string {
  const payload = {
    v: input.schemaVersion,
    env: input.environmentClass,
    primary: input.primaryPurpose,
    secondary: [...input.secondaryPurposes].sort(),
    relationships: [...input.relationshipIntents].sort(),
    pairedRef: input.pairedProductionInstallationRef ?? null,
    confidence: input.confidence,
    status: input.confirmationStatus,
    confirmedBy: input.confirmedByPrincipalId ?? null,
    evidence: input.evidence
      .map((e) => ({
        s: e.source,
        c: e.claim,
        ref: e.sourceRef ?? null,
        fp: e.valueFingerprint ?? null,
      }))
      .sort((a, b) => a.c.localeCompare(b.c)),
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
