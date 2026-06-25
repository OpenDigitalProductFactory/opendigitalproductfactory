// EP-MSP-FEDERATION · B1 — Bearer-token validation for /api/v1/federation/*
// receiving routes. Resolves a presented Authorization: Bearer dpflink_<secret>
// against FederationLink.tokenHash. Mirrors lib/auth/edge-node-token.ts, with the
// dual-approval gate: a link may exchange projections / incidents / proposals
// ONLY when it is fully trusted (both sides approved) and not quarantined/revoked.
// Never logs the plaintext token; never mutates the link row.

import { prisma } from "@dpf/db";
import { canExchangeOverLink } from "@dpf/db/federation-link-types";

import { classifyFederationToken, hashToken } from "@/lib/federation/tokens";

export type ResolveFederationAuthFailure = {
  ok: false;
  error:
    | "missing_authorization"
    | "invalid_scheme"
    | "invalid_token_format"
    | "token_not_found"
    | "link_not_trusted";
  message: string;
};

export type ResolvedFederationAuth = {
  ok: true;
  /** FederationLink.linkId (stable external id). */
  linkId: string;
  /** This deployment's role on the link: "manages" | "managed-by". */
  role: string;
  linkState: string;
  peerOrganizationRef: string | null;
  projectionContractId: string | null;
  authorityBindingId: string | null;
};

export async function resolveFederationLinkAuth(
  authorizationHeader: string | null | undefined,
): Promise<ResolvedFederationAuth | ResolveFederationAuthFailure> {
  if (!authorizationHeader) {
    return { ok: false, error: "missing_authorization", message: "Authorization header is required" };
  }
  const match = /^Bearer\s+(.+)$/.exec(authorizationHeader.trim());
  if (!match) {
    return { ok: false, error: "invalid_scheme", message: "Authorization must use the Bearer scheme" };
  }
  const presented = match[1]?.trim();
  if (!presented) {
    return { ok: false, error: "invalid_scheme", message: "Bearer token is empty" };
  }
  if (classifyFederationToken(presented) !== "link") {
    return { ok: false, error: "invalid_token_format", message: "Federation tokens must use the dpflink_ prefix" };
  }

  const link = await prisma.federationLink.findUnique({ where: { tokenHash: hashToken(presented) } });
  if (!link) {
    return { ok: false, error: "token_not_found", message: "Federation link token does not match any link" };
  }

  // Dual-approval gate — exchange requires a fully trusted (both-approved) link.
  if (
    !canExchangeOverLink({
      approvedAtLocal: link.approvedAtLocal,
      approvedAtPeer: link.approvedAtPeer,
      revokedAt: link.revokedAt,
      quarantinedAt: link.quarantinedAt,
    })
  ) {
    return {
      ok: false,
      error: "link_not_trusted",
      message: `Federation link state '${link.linkState}' cannot exchange (requires dual approval)`,
    };
  }

  return {
    ok: true,
    linkId: link.linkId,
    role: link.role,
    linkState: link.linkState,
    peerOrganizationRef: link.peerOrganizationRef,
    projectionContractId: link.projectionContractId,
    authorityBindingId: link.authorityBindingId,
  };
}
