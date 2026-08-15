// EP-MSP-FEDERATION · B1 — federation enrollment + dual-approval lifecycle
// (BI-130107D6). The edge enrollment lib generalized to deployment-to-deployment.
//
// Handshake (mirrors edge, with dual approval added):
//   1. The Authority operator issues a dpffboot_ invitation (issueFederationBootstrap)
//      bound to the role offered to the peer + a proposed projection/authority band.
//   2. The connecting peer redeems it at POST /api/v1/federation/enroll
//      (enrollFederationLink): we create our Principal(kind="federated-peer") +
//      alias + a PENDING FederationLink and mint a dpflink_ link token.
//   3. Dual approval: our operator approves (approveFederationLinkLocal) AND the
//      peer confirms (recordFederationPeerApproval). The link is `trusted` only
//      when BOTH are set (resolveLinkTrust). Either side quarantines/revokes
//      unilaterally and instantly.

import { randomUUID } from "crypto";

import { prisma } from "@dpf/db";
import {
  FEDERATION_PEER_ALIAS_TYPE,
  FEDERATION_PEER_PRINCIPAL_KIND,
  inverseRole,
  isFederationRole,
  linkStateFromRow,
  type FederationRole,
} from "@dpf/db/federation-link-types";

import { encryptSecret } from "@/lib/govern/credential-crypto";

import {
  classifyFederationToken,
  computeFederationBootstrapExpiry,
  generateFederationBootstrapToken,
  generateLinkToken,
  hashToken,
} from "./tokens";

// ── Issuance (inviter operator) ──────────────────────────────────────────────

export interface IssueFederationBootstrapInput {
  issuedByPrincipalId: string;
  /** Role the ACCEPTING peer will hold (we take the inverse). */
  offeredRole: FederationRole;
  proposedProjection?: Record<string, unknown> | null;
  proposedAuthorityBand?: Record<string, unknown> | null;
  ttlMs?: number;
}

export interface IssueFederationBootstrapResult {
  tokenId: string;
  plaintext: string;
  prefix: string;
  expiresAt: Date;
}

export async function issueFederationBootstrap(
  input: IssueFederationBootstrapInput,
): Promise<IssueFederationBootstrapResult> {
  const { plaintext, hash, prefix } = generateFederationBootstrapToken();
  const expiresAt = computeFederationBootstrapExpiry(input.ttlMs);
  const row = await prisma.federationBootstrapToken.create({
    data: {
      tokenHash: hash,
      prefix,
      offeredRole: input.offeredRole,
      proposedProjection: (input.proposedProjection ?? undefined) as never,
      proposedAuthorityBand: (input.proposedAuthorityBand ?? undefined) as never,
      issuedByPrincipalId: input.issuedByPrincipalId,
      expiresAt,
    },
  });
  return { tokenId: row.id, plaintext, prefix, expiresAt };
}

// ── Enrollment (Authority receives the connecting peer) ──────────────────────

export interface EnrollFederationInput {
  bootstrapToken: string;
  peerAuthorityUrl: string;
  peerOrganizationRef?: string | null;
  localOrganizationId?: string | null;
  displayName: string;
  /** The connecting peer's inbound link token. When present we store it as our
   *  outbound token (peerTokenEnc) so we can relay our approval and push demand
   *  back to them — the mutual half of the handshake. */
  callbackToken?: string | null;
  peerDeviceId?: string | null;
  metadata?: Record<string, unknown>;
}

export type EnrollFederationResult =
  | {
      ok: true;
      linkId: string;
      /** Plaintext link token. SENT TO THE PEER ONCE. */
      linkToken: string;
      role: FederationRole;
      linkState: string;
    }
  | {
      ok: false;
      error:
        | "invalid_token_format"
        | "token_not_found"
        | "token_expired"
        | "token_already_consumed"
        | "token_revoked"
        | "invalid_role";
      message: string;
    };

export async function enrollFederationLink(
  input: EnrollFederationInput,
): Promise<EnrollFederationResult> {
  if (classifyFederationToken(input.bootstrapToken) !== "bootstrap") {
    return { ok: false, error: "invalid_token_format", message: "expected a dpffboot_ token" };
  }

  const presentedHash = hashToken(input.bootstrapToken);
  const tokenRow = await prisma.federationBootstrapToken.findUnique({
    where: { tokenHash: presentedHash },
  });
  if (!tokenRow) {
    return { ok: false, error: "token_not_found", message: "invitation does not match any issued token" };
  }
  if (tokenRow.consumedAt !== null) {
    return { ok: false, error: "token_already_consumed", message: "invitation already consumed" };
  }
  if (tokenRow.revokedAt !== null) {
    return { ok: false, error: "token_revoked", message: "invitation was revoked" };
  }
  if (tokenRow.expiresAt.getTime() <= Date.now()) {
    return { ok: false, error: "token_expired", message: "invitation has expired" };
  }
  if (!isFederationRole(tokenRow.offeredRole)) {
    return { ok: false, error: "invalid_role", message: "invitation carries an invalid role" };
  }

  // Our own role is the inverse of what we offered the peer.
  const ourRole = inverseRole(tokenRow.offeredRole);
  const linkId = `link_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const linkToken = generateLinkToken();
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.federationBootstrapToken.update({
      // Optimistic single-use: only consume if still unconsumed.
      where: { id: tokenRow.id, consumedAt: null },
      data: { consumedAt: now },
    });

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

    const link = await tx.federationLink.create({
      data: {
        linkId,
        principalId: principal.id,
        role: ourRole,
        peerAuthorityUrl: input.peerAuthorityUrl,
        peerOrganizationRef: input.peerOrganizationRef ?? null,
        peerDeviceId: input.peerDeviceId ?? null,
        localOrganizationId: input.localOrganizationId ?? null,
        // Dual approval: both null at enrollment; trusted only after both approve.
        linkState: "pending",
        tokenHash: linkToken.hash,
        tokenPrefix: linkToken.prefix,
        tokenRotatedAt: now,
        // Mutual handshake: the connector's inbound token becomes OUR outbound
        // token, so the inviter can relay its approval and push demand back.
        // Absent (older connector) → one-directional link, as before.
        peerTokenEnc: input.callbackToken ? encryptSecret(input.callbackToken) : null,
        enrolledAt: now,
        metadata: {
          ...(input.metadata ?? {}),
          proposedProjection: tokenRow.proposedProjection ?? null,
          proposedAuthorityBand: tokenRow.proposedAuthorityBand ?? null,
        } as never,
      },
    });

    await tx.federationBootstrapToken.update({
      where: { id: tokenRow.id },
      data: { consumedByLinkId: link.id },
    });
  });

  return { ok: true, linkId, linkToken: linkToken.plaintext, role: ourRole, linkState: "pending" };
}

// ── Dual approval + lifecycle (operator / peer actions) ──────────────────────

async function recomputeAndPersistLinkState(linkId: string): Promise<string> {
  const row = await prisma.federationLink.findUniqueOrThrow({ where: { linkId } });
  const linkState = linkStateFromRow({
    approvedAtLocal: row.approvedAtLocal,
    approvedAtPeer: row.approvedAtPeer,
    revokedAt: row.revokedAt,
    quarantinedAt: row.quarantinedAt,
  });
  if (linkState !== row.linkState) {
    await prisma.federationLink.update({ where: { linkId }, data: { linkState } });
  }
  return linkState;
}

/** Our operator approves the link from our side. */
export async function approveFederationLinkLocal(
  linkId: string,
  approverPrincipalId: string,
): Promise<string> {
  await prisma.federationLink.update({
    where: { linkId },
    data: { approvedAtLocal: new Date(), approvedByPrincipalId: approverPrincipalId },
  });
  return recomputeAndPersistLinkState(linkId);
}

/** The peer confirms from their side (relayed over the link). */
export async function recordFederationPeerApproval(linkId: string): Promise<string> {
  await prisma.federationLink.update({
    where: { linkId },
    data: { approvedAtPeer: new Date() },
  });
  return recomputeAndPersistLinkState(linkId);
}

export async function quarantineFederationLink(linkId: string, reason: string): Promise<string> {
  await prisma.federationLink.update({
    where: { linkId },
    data: { quarantinedAt: new Date(), quarantineReason: reason },
  });
  return recomputeAndPersistLinkState(linkId);
}

export async function revokeFederationLink(linkId: string, reason: string): Promise<string> {
  await prisma.federationLink.update({
    where: { linkId },
    // Revocation also invalidates the link token (auth material cleared).
    data: { revokedAt: new Date(), revocationReason: reason, tokenHash: null },
  });
  return recomputeAndPersistLinkState(linkId);
}
