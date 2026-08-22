// EP-1FABA22D · Purpose-Aware Installation and Ecosystem Productivity
// Impact preview for a change to installation identity.
//
// Parent design §5.3 and §13.3: the profile is editable, and a *material*
// change — a different environment class, purpose, or production pairing —
// requires an impact preview and explicit confirmation before it is written.
//
// The preview is derived, never hand-written. It resolves the stance profile
// twice, once for the identity in force and once for the identity proposed, and
// reports the difference. So the copy an operator reads is the same resolver
// output an agent will honour afterwards; the two cannot drift.
//
// This module is pure. It never reads a database, a file, or the clock.

import { createHash } from "node:crypto";

import {
  resolveInstanceStance,
  type InstanceStanceHostFacts,
  type InstanceStanceProfile,
} from "@dpf/db/installation-instance-stance";
import {
  buildInstallationOperatingProfileSnapshot,
  type InstallationEnvironmentClass,
  type InstallationEvidenceSource,
  type InstallationOperatingIntentEvidence,
  type InstallationOperatingIntentV1,
  type InstallationOperatingPurpose,
} from "@dpf/db/installation-operating-intent";

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
] as const;
export type StanceKey = (typeof STANCE_KEYS)[number];

/** Plain-language field names. Owned here so no component invents its own. */
export const IDENTITY_FIELD_LABEL: Record<IdentityField, string> = {
  primaryPurpose: "Its main job",
  environmentClass: "Environment",
  pairedProductionInstallationRef: "Paired installation",
};

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
};

/**
 * The report-kit intent each stance value renders with.
 *
 * `neutral` means no extra caution applies, `warning` means a brake is on, and
 * `danger` means the action is never available. Nothing here reads as a grant,
 * because a permissive stance is the absence of a brake and not a permission.
 */
export const STANCE_VALUE_INTENT: Record<StanceKey, Record<string, "neutral" | "warning" | "danger">> = {
  credentials: { "local-permitted": "neutral", "operator-only": "warning" },
  teardown: { permitted: "neutral", "capture-required": "warning", forbidden: "danger" },
  sourceAuthority: { "governed-worktree": "neutral", none: "warning" },
  peerWrite: { none: "neutral", "read-only": "warning", "governed-write": "neutral" },
};

/**
 * How cautious each stance value is, higher being more cautious.
 *
 * Direction is computed from this rank rather than asserted per transition, so
 * a new stance value cannot silently be reported as "no change".
 */
const CAUTION_RANK: Record<StanceKey, Record<string, number>> = {
  credentials: { "local-permitted": 0, "operator-only": 1 },
  teardown: { permitted: 0, "capture-required": 1, forbidden: 2 },
  sourceAuthority: { "governed-worktree": 0, none: 1 },
  peerWrite: { "governed-write": 0, "read-only": 1, none: 2 },
};

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

const EMPTY_REF_LABEL = "None";

function refLabel(ref: string | null | undefined): string {
  return ref && ref.trim().length > 0 ? ref.trim() : EMPTY_REF_LABEL;
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

/**
 * The evidence sources each identity field was derived from.
 *
 * Taken from `deriveExistingInstallIntent`, which is the only deriver: those are
 * the exact sources whose inference a human declaration supersedes. Human
 * evidence is never listed — a past confirmation is history, not a stale guess.
 */
const DERIVATION_SOURCES: Record<IdentityField, InstallationEvidenceSource[]> = {
  environmentClass: ["installer"],
  primaryPurpose: ["installer", "organization", "business-context", "capability"],
  pairedProductionInstallationRef: ["federation"],
};

function staleEvidenceFor(
  evidence: readonly InstallationOperatingIntentEvidence[],
  changedFields: readonly IdentityField[],
): StaleEvidenceNote[] {
  const affected = new Set<InstallationEvidenceSource>();
  for (const field of changedFields) {
    for (const source of DERIVATION_SOURCES[field]) affected.add(source);
  }
  const notes: StaleEvidenceNote[] = [];
  for (const entry of evidence) {
    if (entry.source === "human") continue;
    if (!affected.has(entry.source)) continue;
    notes.push({
      source: entry.source,
      claim: entry.claim,
      reason: "This helped guess the identity you are replacing.",
    });
  }
  return notes;
}

function intentWithDeclaration(
  intent: InstallationOperatingIntentV1,
  declaration: InstallationIdentityDeclaration,
): InstallationOperatingIntentV1 {
  return {
    ...intent,
    primaryPurpose: declaration.primaryPurpose,
    secondaryPurposes: intent.secondaryPurposes.filter((p) => p !== declaration.primaryPurpose),
    ...(declaration.pairedProductionInstallationRef
      ? { pairedProductionInstallationRef: declaration.pairedProductionInstallationRef }
      : {}),
  };
}

function stanceFor(
  intent: InstallationOperatingIntentV1,
  declaration: InstallationIdentityDeclaration,
  host: InstanceStanceHostFacts,
  holdsIrreplaceableWork: boolean,
): InstanceStanceProfile {
  const withDeclaration = intentWithDeclaration(intent, declaration);
  if (!declaration.pairedProductionInstallationRef) {
    delete (withDeclaration as { pairedProductionInstallationRef?: string })
      .pairedProductionInstallationRef;
  }
  const snapshot = buildInstallationOperatingProfileSnapshot({
    intent: withDeclaration,
    environmentClass: declaration.environmentClass,
  });
  return resolveInstanceStance(snapshot, host, { holdsIrreplaceableWork });
}

function directionOf(stance: StanceKey, from: string, to: string): StanceDirection {
  if (from === to) return "unchanged";
  const ranks = CAUTION_RANK[stance];
  const before = ranks[from];
  const after = ranks[to];
  if (before === undefined || after === undefined) return "unchanged";
  if (after > before) return "tightens";
  if (after < before) return "loosens";
  return "unchanged";
}

function valueLabel(stance: StanceKey, value: string): string {
  return STANCE_VALUE_LABEL[stance][value] ?? value;
}

function buildWarnings(input: {
  current: InstallationIdentityDeclaration;
  next: InstallationIdentityDeclaration;
  loosened: readonly StanceDelta[];
}): string[] {
  const warnings: string[] = [];
  const { current, next, loosened } = input;

  const teardownLoosened = loosened.find((d) => d.stance === "teardown");
  if (teardownLoosened) {
    warnings.push(
      `Teardown moves from "${teardownLoosened.from}" to "${teardownLoosened.to}". An agent may then destroy this installation.`,
    );
  }

  const credentialsLoosened = loosened.find((d) => d.stance === "credentials");
  if (credentialsLoosened) {
    warnings.push("Agents may start handling credentials here without an operator hand-off.");
  }

  const peerLoosened = loosened.find((d) => d.stance === "peerWrite");
  if (peerLoosened) {
    warnings.push(
      `Writes to ${refLabel(next.pairedProductionInstallationRef)} move from "${peerLoosened.from}" to "${peerLoosened.to}".`,
    );
  }

  if (
    next.primaryPurpose === "operate-organization"
    && current.primaryPurpose !== "operate-organization"
  ) {
    warnings.push("This installation becomes the one that can make funding decisions.");
  }

  if (
    current.primaryPurpose === "operate-organization"
    && next.primaryPurpose !== "operate-organization"
  ) {
    warnings.push("This installation stops being the one that can make funding decisions.");
  }

  if (current.pairedProductionInstallationRef && !next.pairedProductionInstallationRef) {
    warnings.push(
      `The pairing with ${current.pairedProductionInstallationRef} is dropped. Existing federation links are untouched, and revoking one stays its own governed action.`,
    );
  }

  return warnings;
}

/**
 * Compute the deterministic token that binds a confirmation to this preview.
 *
 * Covers both sides of the change, so editing a field after previewing produces
 * a different token and the stored confirmation cannot be reused.
 */
export function computeIdentityPreviewToken(
  current: InstallationIdentityDeclaration,
  next: InstallationIdentityDeclaration,
): string {
  const payload = {
    from: {
      purpose: current.primaryPurpose,
      env: current.environmentClass,
      paired: current.pairedProductionInstallationRef ?? null,
    },
    to: {
      purpose: next.primaryPurpose,
      env: next.environmentClass,
      paired: next.pairedProductionInstallationRef ?? null,
    },
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32);
}

/**
 * Build the impact preview for a proposed identity.
 *
 * `current` is the identity in force, including the environment class the
 * precedence chain resolved — not the one stored in the semantic intent, which
 * does not own that fact.
 */
export function buildInstallationIdentityImpact(input: {
  intent: InstallationOperatingIntentV1;
  current: InstallationIdentityDeclaration;
  next: InstallationIdentityDeclaration;
  host: InstanceStanceHostFacts;
  holdsIrreplaceableWork: boolean;
}): InstallationIdentityImpact {
  const current = normalizeIdentityDeclaration(input.current);
  const next = normalizeIdentityDeclaration(input.next);

  const changes: IdentityFieldChange[] = [];
  if (current.primaryPurpose !== next.primaryPurpose) {
    changes.push({
      field: "primaryPurpose",
      label: IDENTITY_FIELD_LABEL.primaryPurpose,
      from: PURPOSE_LABEL[current.primaryPurpose],
      to: PURPOSE_LABEL[next.primaryPurpose],
    });
  }
  if (current.environmentClass !== next.environmentClass) {
    changes.push({
      field: "environmentClass",
      label: IDENTITY_FIELD_LABEL.environmentClass,
      from: ENVIRONMENT_CLASS_LABEL[current.environmentClass],
      to: ENVIRONMENT_CLASS_LABEL[next.environmentClass],
    });
  }
  if (current.pairedProductionInstallationRef !== next.pairedProductionInstallationRef) {
    changes.push({
      field: "pairedProductionInstallationRef",
      label: IDENTITY_FIELD_LABEL.pairedProductionInstallationRef,
      from: refLabel(current.pairedProductionInstallationRef),
      to: refLabel(next.pairedProductionInstallationRef),
    });
  }

  const before = stanceFor(input.intent, current, input.host, input.holdsIrreplaceableWork);
  const after = stanceFor(input.intent, next, input.host, input.holdsIrreplaceableWork);

  const stanceDeltas: StanceDelta[] = STANCE_KEYS.map((stance) => {
    const from = before[stance] as string;
    const to = after[stance] as string;
    return {
      stance,
      label: STANCE_LABEL[stance],
      from: valueLabel(stance, from),
      to: valueLabel(stance, to),
      direction: directionOf(stance, from, to),
      rationale: after.rationale[stance],
    };
  });

  const loosenedStances = stanceDeltas.filter((d) => d.direction === "loosens");

  return {
    material: changes.length > 0,
    changes,
    stanceDeltas,
    loosenedStances,
    staleEvidence: staleEvidenceFor(input.intent.evidence, changes.map((c) => c.field)),
    warnings: buildWarnings({ current, next, loosened: loosenedStances }),
    previewToken: computeIdentityPreviewToken(current, next),
  };
}
