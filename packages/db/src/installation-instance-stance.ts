// EP-1FABA22D · Purpose-Aware Installation and Ecosystem Productivity
// Instance stance resolution: the behavioural half of installation identity.
//
// `installation-operating-intent.ts` records *what this installation is for*. That
// record is inert on its own — nothing reads it to decide what an agent may do.
// This module is the missing half: a pure, total function from the operating
// profile snapshot to the stances every agent-facing surface must honour.
//
// The durable rule from the design still holds: a stance expresses *caution*, it
// never grants identity, trust, authority, or permission. A permissive stance is
// the absence of an extra brake, not a grant. Authority remains TAK, GAID, and
// the federation link lifecycle.

import type {
  InstallationEnvironmentClass,
  InstallationOperatingProfileSnapshot,
  InstallationOperatingPurpose,
} from "./installation-operating-intent";

/** How this instance may handle credential material. */
export const CREDENTIAL_STANCES = ["operator-only", "local-permitted"] as const;
export type CredentialStance = (typeof CREDENTIAL_STANCES)[number];

/** Whether destructive teardown of this instance is available, and on what terms. */
export const TEARDOWN_STANCES = [
  "forbidden",
  "capture-required",
  "permitted",
] as const;
export type TeardownStance = (typeof TEARDOWN_STANCES)[number];

/** Where source changes for this instance are authored. */
export const SOURCE_AUTHORITY_STANCES = ["none", "governed-worktree"] as const;
export type SourceAuthorityStance = (typeof SOURCE_AUTHORITY_STANCES)[number];

/** Whether this instance mirrors the work it owns to same-organization peers. */
export const WORK_SYNC_STANCES = ["same-organization", "none"] as const;
export type WorkSyncStance = (typeof WORK_SYNC_STANCES)[number];

/** What this instance may do to a federated peer it is paired with. */
export const PEER_WRITE_STANCES = ["read-only", "governed-write", "none"] as const;
export type PeerWriteStance = (typeof PEER_WRITE_STANCES)[number];

/**
 * The resolved operating stances for one installation.
 *
 * `rationale` explains the resolution in one sentence per stance so agent-facing
 * surfaces can show *why* a brake exists rather than asserting it bare.
 */
export interface InstanceStanceProfile {
  schemaVersion: 1;
  environmentClass: InstallationEnvironmentClass;
  primaryPurpose: InstallationOperatingPurpose;
  /** True when losing this instance would destroy work that exists nowhere else. */
  holdsIrreplaceableWork: boolean;
  credentials: CredentialStance;
  teardown: TeardownStance;
  sourceAuthority: SourceAuthorityStance;
  peerWrite: PeerWriteStance;
  workSync: WorkSyncStance;
  pairedProductionInstallationRef?: string;
  rationale: {
    credentials: string;
    teardown: string;
    sourceAuthority: string;
    peerWrite: string;
    workSync: string;
  };
}

/**
 * Host facts the stance resolver needs but the operating intent does not own.
 *
 * `sourceCapable` comes from the install host profile (`.install-mode` plus the
 * presence of a Git checkout). Installation intent must not restate it — a
 * consumer runtime install has no source authority regardless of its purpose.
 */
export interface InstanceStanceHostFacts {
  sourceCapable: boolean;
  /**
   * True when a live same-organization federation link backs the declared peer.
   * Resolved by `resolveInstallationPairing`; false leaves work sync off, because
   * a declared name is intent and a link is evidence.
   */
  pairingIsEstablished?: boolean;
}

function resolveCredentials(
  environmentClass: InstallationEnvironmentClass,
): { stance: CredentialStance; rationale: string } {
  if (environmentClass === "production") {
    return {
      stance: "operator-only",
      rationale:
        "This is a production installation, so credentials are entered by the operator and never handled by an agent.",
    };
  }
  return {
    stance: "local-permitted",
    rationale:
      `This is a ${environmentClass} installation, so local test credentials may be generated and rotated without an operator hand-off.`,
  };
}

function resolveTeardown(
  environmentClass: InstallationEnvironmentClass,
  holdsIrreplaceableWork: boolean,
): { stance: TeardownStance; rationale: string } {
  if (environmentClass === "production") {
    return {
      stance: "forbidden",
      rationale:
        "This is a production installation, so teardown is never an agent action.",
    };
  }
  if (holdsIrreplaceableWork) {
    return {
      stance: "capture-required",
      rationale:
        `This ${environmentClass} installation holds work that exists nowhere else, so capture a durable backlog bundle before any teardown.`,
    };
  }
  return {
    stance: "permitted",
    rationale:
      `This is a ${environmentClass} installation with no uncaptured work, so teardown and rebuild are routine.`,
  };
}

function resolveSourceAuthority(
  sourceCapable: boolean,
): { stance: SourceAuthorityStance; rationale: string } {
  if (sourceCapable) {
    return {
      stance: "governed-worktree",
      rationale:
        "A Git checkout is present, so source changes belong in a governed worktree behind the usual review gates.",
    };
  }
  return {
    stance: "none",
    rationale:
      "This directory holds installed runtime assets and no source, so edit platform source in a separate checkout and never treat these files as source.",
  };
}

function resolvePeerWrite(
  environmentClass: InstallationEnvironmentClass,
  pairedRef: string | undefined,
): { stance: PeerWriteStance; rationale: string } {
  if (!pairedRef) {
    return {
      stance: "none",
      rationale: "No paired installation is recorded, so there is no peer to read or write.",
    };
  }
  if (environmentClass === "production") {
    return {
      stance: "governed-write",
      rationale:
        "Both installations are production, so peer writes follow the approved federation link and its projection contract.",
    };
  }
  return {
    stance: "read-only",
    rationale:
      `This ${environmentClass} installation is paired with ${pairedRef}, so read that peer for realistic context and never mutate a record it owns.`,
  };
}

/**
 * Decide whether this instance mirrors its own work to same-organization peers.
 *
 * Mirroring a record this installation is canonical for is NOT a peer write: the
 * federated record mirror lets only the canonical side mutate, so publishing our
 * own backlog to an organization peer never touches a record the peer owns. An
 * install that is created and destroyed repeatedly depends on this — without it
 * the work it produced dies with it.
 */
function resolveWorkSync(
  pairedRef: string | undefined,
  pairingIsEstablished: boolean,
): { stance: WorkSyncStance; rationale: string } {
  if (!pairedRef) {
    return {
      stance: "none",
      rationale: "No paired installation is recorded, so there is nowhere to mirror work.",
    };
  }
  if (!pairingIsEstablished) {
    // A typed peer name gives nothing to send work to. Reporting
    // `same-organization` here would tell an agent its work is safe when no link
    // exists to carry it.
    return {
      stance: "none",
      rationale:
        `${pairedRef} is declared but no established federation link confirms it, so there is nowhere to mirror work yet.`,
    };
  }
  return {
    stance: "same-organization",
    rationale:
      `Mirror the backlog this installation owns to ${pairedRef} so the work survives a teardown; only this side may change those records.`,
  };
}

/**
 * Resolve the stances an agent must honour on this installation.
 *
 * Pure and total: equal inputs always produce an equal profile, and every
 * environment class and purpose in the closed vocabularies resolves. Callers pass
 * `holdsIrreplaceableWork` from the durable-capture check rather than having this
 * module reach for a database.
 */
export function resolveInstanceStance(
  snapshot: InstallationOperatingProfileSnapshot,
  host: InstanceStanceHostFacts,
  options: { holdsIrreplaceableWork?: boolean } = {},
): InstanceStanceProfile {
  const holdsIrreplaceableWork = options.holdsIrreplaceableWork ?? false;
  const credentials = resolveCredentials(snapshot.environmentClass);
  const teardown = resolveTeardown(snapshot.environmentClass, holdsIrreplaceableWork);
  const sourceAuthority = resolveSourceAuthority(host.sourceCapable);
  const peerWrite = resolvePeerWrite(
    snapshot.environmentClass,
    snapshot.pairedProductionInstallationRef,
  );
  const workSync = resolveWorkSync(
    snapshot.pairedProductionInstallationRef,
    host.pairingIsEstablished ?? false,
  );

  return {
    schemaVersion: 1,
    environmentClass: snapshot.environmentClass,
    primaryPurpose: snapshot.primaryPurpose,
    holdsIrreplaceableWork,
    credentials: credentials.stance,
    teardown: teardown.stance,
    sourceAuthority: sourceAuthority.stance,
    peerWrite: peerWrite.stance,
    workSync: workSync.stance,
    pairedProductionInstallationRef: snapshot.pairedProductionInstallationRef,
    rationale: {
      credentials: credentials.rationale,
      teardown: teardown.rationale,
      sourceAuthority: sourceAuthority.rationale,
      peerWrite: peerWrite.rationale,
      workSync: workSync.rationale,
    },
  };
}

/**
 * Render the stance profile as the compact block agent-facing channels embed.
 *
 * Deliberately small. It states the instance's identity and its brakes, and it
 * carries no secrets, no business data, and no tool catalogue.
 */
export function formatInstanceStanceBriefing(
  stance: InstanceStanceProfile,
  /**
   * Which installation this is, e.g. `Northwind DEV (did_ab12…9f0c)` (BI-C7151B1B).
   *
   * Optional because it is composed one layer up, where the estate name and the
   * device id are readable. When absent the briefing still states the class and
   * purpose, so an agent is never left with nothing — it just cannot tell two
   * installs of one organization apart, which is the defect this closes.
   */
  installationLabel?: string,
): string {
  const lines = installationLabel
    ? [`INSTALLATION: ${installationLabel}.`]
    : [];
  lines.push(
    `INSTALLATION IDENTITY: ${stance.environmentClass} installation, purpose ${stance.primaryPurpose}.`,
  );
  if (stance.pairedProductionInstallationRef) {
    lines.push(`Paired installation: ${stance.pairedProductionInstallationRef}.`);
  }
  lines.push(`Credentials — ${stance.credentials}: ${stance.rationale.credentials}`);
  lines.push(`Teardown — ${stance.teardown}: ${stance.rationale.teardown}`);
  lines.push(`Source — ${stance.sourceAuthority}: ${stance.rationale.sourceAuthority}`);
  lines.push(`Peer — ${stance.peerWrite}: ${stance.rationale.peerWrite}`);
  lines.push(`Work sync — ${stance.workSync}: ${stance.rationale.workSync}`);
  return lines.join("\n");
}
