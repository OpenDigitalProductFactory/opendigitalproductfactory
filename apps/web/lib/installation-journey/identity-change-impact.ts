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
// This module is pure, but NOT client-safe: it hashes with `node:crypto`. The
// display half of the contract — labels, option lists, and the shape of the data
// the panel renders — lives in `./identity-presentation`, which the client
// component imports instead. Keep it that way; moving a label back here bundles
// crypto into the browser.

import { createHash } from "node:crypto";

import {
  resolveInstanceStance,
  type InstanceStanceHostFacts,
  type InstanceStanceProfile,
} from "@dpf/db/installation-instance-stance";
import {
  buildInstallationOperatingProfileSnapshot,
  type InstallationEvidenceSource,
  type InstallationOperatingIntentEvidence,
  type InstallationOperatingIntentV1,
} from "@dpf/db/installation-operating-intent";

import {
  ENVIRONMENT_CLASS_LABEL,
  IDENTITY_FIELD_LABEL,
  PURPOSE_LABEL,
  STANCE_KEYS,
  STANCE_LABEL,
  STANCE_VALUE_LABEL,
  normalizeIdentityDeclaration,
  type IdentityField,
  type IdentityFieldChange,
  type InstallationIdentityDeclaration,
  type InstallationIdentityImpact,
  type StanceDelta,
  type StanceDirection,
  type StanceKey,
  type StaleEvidenceNote,
} from "@/lib/installation-journey/identity-presentation";

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
  // Having somewhere to mirror work is the safer state: losing the peer means a
  // teardown would take the backlog with it.
  workSync: { "same-organization": 0, none: 1 },
};

const EMPTY_REF_LABEL = "None";

function refLabel(ref: string | null | undefined): string {
  return ref && ref.trim().length > 0 ? ref.trim() : EMPTY_REF_LABEL;
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
    // Deliberately not phrased as "writes": adding a pairing to a development
    // install loosens the stance from "no peer" to "read only", which is a wider
    // reach without being a write.
    warnings.push(
      `What this installation may do to ${refLabel(next.pairedProductionInstallationRef)} moves from "${peerLoosened.from}" to "${peerLoosened.to}".`,
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
