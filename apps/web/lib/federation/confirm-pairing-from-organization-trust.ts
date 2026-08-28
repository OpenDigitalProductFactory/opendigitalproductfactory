// EP-MSP-FEDERATION — confirm a pairing on the strength of organization trust.
//
// The SAS code exists to authenticate a peer this installation has no prior
// relationship with: two people read six digits off two screens and agree they
// match. That is the right ceremony between strangers.
//
// It adds nothing when the organization CA has already authenticated the peer.
// A validated certificate chain is a stronger statement than a six-digit
// comparison, and it is the same authority that would have issued the peer its
// identity in the first place. Requiring both means an installation created and
// destroyed thousands of times can never pair unattended.
//
// This performs the same confirmation the human path performs, and records WHY:
// no person confirmed it, organization trust did, and here is the evidence. The
// approving principal stays null, because none exists — writing a person's id
// there would make the audit trail assert something untrue.

import type { AutomaticPairingDecision } from "@dpf/db/automatic-pairing-decision";

/** Why an organization-trust confirmation was refused. Closed for branching. */
export const TRUST_CONFIRMATION_REFUSALS = [
  "not-auto-enroll",
  "session-not-found",
  "session-not-pending",
  "session-expired",
  "peer-confirmation-failed",
] as const;
export type TrustConfirmationRefusal = (typeof TRUST_CONFIRMATION_REFUSALS)[number];

export interface PairingSessionRow {
  id: string;
  pairingId: string;
  direction: string;
  status: string;
  expiresAt: Date;
  sasState: unknown;
}

export interface TrustConfirmationStore {
  findSession(pairingId: string): Promise<PairingSessionRow | null>;
  /**
   * Record local confirmation. `approvedByPrincipalId` is deliberately absent:
   * no person confirmed this, and the store must not invent one.
   */
  recordLocalConfirmation(input: {
    id: string;
    confirmedAt: Date;
    sasState: Record<string, unknown>;
  }): Promise<void>;
}

export type TrustConfirmationResult =
  | { confirmed: true; provenance: "organization-trust" }
  | { confirmed: false; refusal: TrustConfirmationRefusal };

/** The evidence that justified skipping the code comparison. */
export interface TrustConfirmationEvidence {
  presentedRootFingerprint: string | null;
  certificateVerified: boolean;
  peerOrganizationRef: string | null;
}

function refuse(refusal: TrustConfirmationRefusal): TrustConfirmationResult {
  return { confirmed: false, refusal };
}

/**
 * Confirm a pending outgoing pairing because organization trust proved the peer.
 *
 * Refuses on anything short of `auto-enroll`. The verdict is checked by its
 * exact value rather than by ruling out `blocked`, so an
 * `operator-confirmation` verdict can never fall through into an automatic
 * confirmation.
 *
 * The peer must still accept the confirmation; a peer that refuses leaves the
 * session pending for a human, exactly as before.
 */
export async function confirmPairingFromOrganizationTrust(input: {
  pairingId: string;
  decision: AutomaticPairingDecision;
  evidence: TrustConfirmationEvidence;
  store: TrustConfirmationStore;
  confirmWithPeer: (pairingId: string) => Promise<{ ok: boolean }>;
  now: Date;
}): Promise<TrustConfirmationResult> {
  if (input.decision.mode !== "auto-enroll") return refuse("not-auto-enroll");

  const session = await input.store.findSession(input.pairingId);
  if (!session || session.direction !== "outgoing") return refuse("session-not-found");
  if (session.status !== "pending") return refuse("session-not-pending");
  if (session.expiresAt.getTime() <= input.now.getTime()) return refuse("session-expired");

  const peer = await input.confirmWithPeer(input.pairingId);
  if (!peer.ok) return refuse("peer-confirmation-failed");

  const priorState =
    typeof session.sasState === "object" && session.sasState !== null && !Array.isArray(session.sasState)
      ? (session.sasState as Record<string, unknown>)
      : {};

  await input.store.recordLocalConfirmation({
    id: session.id,
    confirmedAt: input.now,
    sasState: {
      ...priorState,
      // Stated plainly so a reader of this record knows a machine confirmed it,
      // on what basis, and that no person was involved.
      confirmationProvenance: "organization-trust",
      confirmationEvidence: {
        presentedRootFingerprint: input.evidence.presentedRootFingerprint,
        certificateVerified: input.evidence.certificateVerified,
        peerOrganizationRef: input.evidence.peerOrganizationRef,
        decidedAt: input.now.toISOString(),
      },
    },
  });

  return { confirmed: true, provenance: "organization-trust" };
}
