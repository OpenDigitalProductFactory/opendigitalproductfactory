// EP-1FABA22D · Purpose-Aware Installation and Ecosystem Productivity
// The client-safe half of the installation-identity contract.
//
// WHY THIS FILE EXISTS, SEPARATELY: the workspace panel is a `"use client"`
// component, so every module it imports for a VALUE is bundled for the browser.
// Its sibling modules cannot be: `identity-change-impact` hashes with
// `node:crypto`, and `installation-identity-view` reaches installer state
// through `node:fs/promises`. Importing a label map out of either dragged
// `node:fs/promises` into the client chunk and broke the production build with
// "the chunking context does not support external modules".
//
// So the display contract — the plain-language names, the shape of the data the
// panel renders, and the option lists — lives here, with **no value import that
// touches Node**. `@dpf/db/installation-operating-intent` is imported for TYPES
// ONLY; it pulls in `crypto` for its fingerprint helper, and `import type` is
// erased at build time.
//
// Rule for anything added here: types and literals only. If it needs a Node
// built-in, a database, or the filesystem, it belongs in one of the server
// modules instead.

import type { InstanceStanceProfile } from "@dpf/db/installation-instance-stance";
import type {
  InstallationEnvironmentClass,
  InstallationEvidenceSource,
  InstallationIntentConfirmationStatus,
  InstallationOperatingPurpose,
} from "@dpf/db/installation-operating-intent";

import type { EnvironmentClassResolution } from "@/lib/install/environment-class-contract";

/** What an operator can declare about this installation from the portal. */
export interface InstallationIdentityDeclaration {
  primaryPurpose: InstallationOperatingPurpose;
  environmentClass: InstallationEnvironmentClass;
  /** Null clears the pairing. Trimmed by the caller. */
  pairedProductionInstallationRef: string | null;
}

export const IDENTITY_FIELDS = [
  "primaryPurpose",
  "environmentClass",
  "pairedProductionInstallationRef",
] as const;
export type IdentityField = (typeof IDENTITY_FIELDS)[number];

export const STANCE_KEYS = [
  "credentials",
  "teardown",
  "sourceAuthority",
  "peerWrite",
  "workSync",
] as const;
export type StanceKey = (typeof STANCE_KEYS)[number];

/** Plain-language field names. Owned here so no component invents its own. */
export const IDENTITY_FIELD_LABEL: Record<IdentityField, string> = {
  primaryPurpose: "Its main job",
  environmentClass: "Environment",
  pairedProductionInstallationRef: "Paired installation",
};

// Every label map below is a total `Record` over its closed vocabulary, so
// adding a purpose, environment class, or stance value fails to compile until
// it has been given words an operator can read.
export const PURPOSE_LABEL: Record<InstallationOperatingPurpose, string> = {
  "operate-organization": "Run our organization",
  "evolve-dpf": "Safely improve another DPF",
  "deliver-managed-services": "Operate DPF for customers",
  "grow-channel": "Grow DPF in a market or region",
  "participate-community": "Join the DPF community",
};

export const ENVIRONMENT_CLASS_LABEL: Record<InstallationEnvironmentClass, string> = {
  production: "Production",
  development: "Development",
  test: "Test",
};

export const STANCE_LABEL: Record<StanceKey, string> = {
  credentials: "Credentials",
  teardown: "Teardown",
  sourceAuthority: "Source changes",
  peerWrite: "Paired installation",
  workSync: "Work sync",
};

/** Plain-language stance values, keyed by stance then by the resolver's value. */
export const STANCE_VALUE_LABEL: Record<StanceKey, Record<string, string>> = {
  credentials: {
    "operator-only": "Operator only",
    "local-permitted": "Local test keys allowed",
  },
  teardown: {
    forbidden: "Never",
    "capture-required": "Capture work first",
    permitted: "Allowed",
  },
  sourceAuthority: {
    none: "Not here",
    "governed-worktree": "Governed worktree",
  },
  peerWrite: {
    none: "No peer",
    "read-only": "Read only",
    "governed-write": "Governed writes",
  },
  workSync: {
    none: "Nowhere to mirror",
    "same-organization": "Mirrored to the organization",
  },
};

/**
 * The report-kit intent each stance value renders with.
 *
 * `neutral` means no extra caution applies, `warning` means a brake is on, and
 * `danger` means the action is never available. Nothing here reads as a grant,
 * because a permissive stance is the absence of a brake and not a permission.
 */
export const STANCE_VALUE_INTENT: Record<
  StanceKey,
  Record<string, "neutral" | "warning" | "danger">
> = {
  credentials: { "local-permitted": "neutral", "operator-only": "warning" },
  teardown: { permitted: "neutral", "capture-required": "warning", forbidden: "danger" },
  sourceAuthority: { "governed-worktree": "neutral", none: "warning" },
  peerWrite: { none: "neutral", "read-only": "warning", "governed-write": "neutral" },
  // Mirroring is how work survives a teardown, so having nowhere to mirror is
  // the state that deserves the brake, not the state that has a peer.
  workSync: { "same-organization": "neutral", none: "warning" },
};

/** How each confirmation status is shown. Owned here, not in the component. */
export const CONFIRMATION_PRESENTATION: Record<
  InstallationIntentConfirmationStatus,
  { label: string; intent: "success" | "info" | "warning" }
> = {
  confirmed: { label: "Confirmed", intent: "success" },
  suggested: { label: "Suggested", intent: "info" },
  "needs-review": { label: "Needs review", intent: "warning" },
};

/**
 * Ordered option lists for the change form.
 *
 * Spelled out rather than mapped from `INSTALLATION_OPERATING_PURPOSES`, because
 * that array is a VALUE export of a module that imports `crypto` — reading it
 * here would bundle a crypto polyfill into the panel for two lists of strings.
 * `identity-presentation.test.ts` asserts these stay identical to the closed
 * vocabularies, so the decoupling cannot drift into a missing option.
 */
export const PURPOSE_OPTIONS: ReadonlyArray<{
  value: InstallationOperatingPurpose;
  label: string;
}> = [
  { value: "operate-organization", label: PURPOSE_LABEL["operate-organization"] },
  { value: "evolve-dpf", label: PURPOSE_LABEL["evolve-dpf"] },
  { value: "deliver-managed-services", label: PURPOSE_LABEL["deliver-managed-services"] },
  { value: "grow-channel", label: PURPOSE_LABEL["grow-channel"] },
  { value: "participate-community", label: PURPOSE_LABEL["participate-community"] },
];

export const ENVIRONMENT_OPTIONS: ReadonlyArray<{
  value: InstallationEnvironmentClass;
  label: string;
}> = [
  { value: "production", label: ENVIRONMENT_CLASS_LABEL.production },
  { value: "development", label: ENVIRONMENT_CLASS_LABEL.development },
  { value: "test", label: ENVIRONMENT_CLASS_LABEL.test },
];

export type StanceDirection = "tightens" | "loosens" | "unchanged";

export interface IdentityFieldChange {
  field: IdentityField;
  label: string;
  from: string;
  to: string;
}

export interface StanceDelta {
  stance: StanceKey;
  label: string;
  from: string;
  to: string;
  direction: StanceDirection;
  /** The rationale the resolver will give once the change is in force. */
  rationale: string;
}

export interface StaleEvidenceNote {
  source: InstallationEvidenceSource;
  claim: string;
  /** Why this entry stops describing the installation. */
  reason: string;
}

export interface InstallationIdentityImpact {
  /** True when any identity field changes. Only a material change needs confirming. */
  material: boolean;
  changes: IdentityFieldChange[];
  stanceDeltas: StanceDelta[];
  /** Only the stances that actually move, for the "what loosens" summary. */
  loosenedStances: StanceDelta[];
  staleEvidence: StaleEvidenceNote[];
  warnings: string[];
  /**
   * Binds a confirmation to the preview that produced it. The action recomputes
   * the preview and refuses a token that does not match, so a change can never
   * be confirmed against a preview the operator never saw.
   */
  previewToken: string;
}

/** One stance row: what the brake is, and the resolver's reason for it. */
export interface StanceRow {
  stance: StanceKey;
  label: string;
  value: string;
  valueLabel: string;
  intent: "neutral" | "warning" | "danger";
  rationale: string;
}

export interface InstallationIdentityView {
  stance: InstanceStanceProfile;
  environment: EnvironmentClassResolution;
  /** Whether a readable intent record exists at all. */
  intentStatus: "valid" | "missing" | "invalid";
  confirmationStatus: InstallationIntentConfirmationStatus;
  /** The identity actually in force, which the change form starts from. */
  declaration: InstallationIdentityDeclaration;
  /** One sentence naming what this installation is. */
  headline: string;
  /** A second sentence for the pairing and the environment's authority, when either has something to say. */
  detail: string | null;
  stances: StanceRow[];
}

/** Normalise a declaration so an empty pairing is always `null`, never `""`. */
export function normalizeIdentityDeclaration(
  input: InstallationIdentityDeclaration,
): InstallationIdentityDeclaration {
  const ref = input.pairedProductionInstallationRef?.trim() ?? "";
  return {
    primaryPurpose: input.primaryPurpose,
    environmentClass: input.environmentClass,
    pairedProductionInstallationRef: ref.length > 0 ? ref : null,
  };
}
