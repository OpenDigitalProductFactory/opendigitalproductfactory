// EP-MSP-FEDERATION · R4 — outbound federation enrollment.
//
// The other half of the handshake: THIS deployment redeems a peer's invitation
// to establish our side of a FederationLink and store the peer-issued link token
// (encrypted at rest) so we can later call the peer's receiving routes.
//
// Role semantics: the peer's bootstrap offered US a role; the peer's enroll
// response carries the PEER's own role, so ours is the inverse. Both sides land
// `pending` — dual approval still applies (our operator approves locally; the
// peer-approval relay that flips approvedAtPeer is a separate protocol slice).

import { randomUUID } from "crypto";

import { prisma } from "@dpf/db";
import {
  FEDERATION_PEER_ALIAS_TYPE,
  FEDERATION_PEER_PRINCIPAL_KIND,
  inverseRole,
  isFederationRole,
} from "@dpf/db/federation-link-types";

import { decryptSecret, encryptSecret } from "@/lib/govern/credential-crypto";

import { postToPeer } from "./client";

export interface EnrollWithPeerInput {
  /** The peer Authority Core base URL. */
  peerAuthorityUrl: string;
  /** The single-use dpffboot_ invitation the peer's operator gave us. */
  bootstrapToken: string;
  /** Our own Authority Core base URL (so the peer can reach us). */
  localAuthorityUrl: string;
  /** How the peer should label us. */
  displayName: string;
  localOrganizationId?: string | null;
  peerOrganizationRef?: string | null;
  fetchImpl?: typeof fetch;
}

export type EnrollWithPeerResult =
  | { ok: true; linkId: string; linkState: string; role: string }
  | { ok: false; error: string; message: string };

interface PeerEnrollResponse {
  ok?: boolean;
  linkId?: string;
  linkToken?: string;
  role?: string;
  linkState?: string;
  error?: string;
  message?: string;
}

export async function enrollWithPeer(input: EnrollWithPeerInput): Promise<EnrollWithPeerResult> {
  // Reuse the generic peer-POST. The enroll body fields are from the RECEIVER's
  // POV, so we send OUR url/org as the "peer" the receiver records.
  const res = await postToPeer({
    peerAuthorityUrl: input.peerAuthorityUrl,
    linkToken: input.bootstrapToken,
    path: "/api/v1/federation/enroll",
    cloudEvent: {
      peerAuthorityUrl: input.localAuthorityUrl,
      displayName: input.displayName,
      ...(input.localOrganizationId ? { peerOrganizationRef: input.localOrganizationId } : {}),
    },
    // Operator-initiated connect: allow a private-LAN peer over http without the
    // global flag. The role is not known until the peer responds, so this is
    // scoped by the private-host check in safePeerRequestUrl — a public peer URL
    // still requires HTTPS here.
    sameOrgLan: true,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  });

  if (!res.ok) {
    const body = res.body as PeerEnrollResponse | undefined;
    return { ok: false, error: body?.error ?? "peer_unreachable", message: body?.message ?? `peer responded ${res.status}` };
  }
  const body = res.body as PeerEnrollResponse | undefined;
  if (!body?.linkToken || !body.role || !isFederationRole(body.role)) {
    return { ok: false, error: "invalid_peer_response", message: "peer did not return a usable link token/role" };
  }

  const ourRole = inverseRole(body.role);
  const linkId = `link_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const principal = await tx.principal.create({
      data: {
        principalId: `principal_${linkId}`,
        kind: FEDERATION_PEER_PRINCIPAL_KIND,
        displayName: input.displayName,
      },
    });
    await tx.principalAlias.create({
      data: { principalId: principal.id, aliasType: FEDERATION_PEER_ALIAS_TYPE, aliasValue: linkId },
    });
    await tx.federationLink.create({
      data: {
        linkId,
        principalId: principal.id,
        role: ourRole,
        peerAuthorityUrl: input.peerAuthorityUrl,
        peerOrganizationRef: input.peerOrganizationRef ?? null,
        localOrganizationId: input.localOrganizationId ?? null,
        linkState: "pending",
        // Outbound token (peer-issued) encrypted at rest; no inbound token here.
        peerTokenEnc: encryptSecret(body.linkToken!),
        enrolledAt: now,
      },
    });
  });

  return { ok: true, linkId, linkState: "pending", role: ourRole };
}

/** Decrypt a stored peer link token for an outbound call. Null if absent/undecryptable. */
export function decryptPeerToken(peerTokenEnc: string | null | undefined): string | null {
  if (!peerTokenEnc) return null;
  return decryptSecret(peerTokenEnc);
}

/**
 * Relay OUR local approval to the peer (dual-approval). Best-effort: a relay
 * failure must not fail our local approval — the peer can be re-notified. Returns
 * whether the peer accepted. Needs the peer-issued token (from outbound enroll).
 */
export async function relayApprovalToPeer(
  link: { linkId: string; peerAuthorityUrl: string; peerTokenEnc: string | null; role?: string },
  fetchImpl?: typeof fetch,
): Promise<{ ok: boolean; reason?: string }> {
  const token = decryptPeerToken(link.peerTokenEnc);
  if (!token) return { ok: false, reason: "no-peer-token" };
  const res = await postToPeer({
    peerAuthorityUrl: link.peerAuthorityUrl,
    linkToken: token,
    path: "/api/v1/federation/approval-relay",
    cloudEvent: { type: "dpf.federation.approval", linkId: link.linkId },
    sameOrgLan: link.role === "same-org-peer",
    ...(fetchImpl ? { fetchImpl } : {}),
  });
  return res.ok ? { ok: true } : { ok: false, reason: `peer responded ${res.status}` };
}
