"use server";

// EP-MSP-FEDERATION · B1 operator surface — server actions for
// Platform > Federation Links. Mirrors lib/actions/edge-nodes.ts: a
// manage_platform permission guard + principal resolution for audit, wrapping
// the federation enrollment lib (lib/federation/enrollment). All mutations
// revalidate the admin path so the UI sees fresh state.

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";

import { prisma } from "@dpf/db";
import { DEMAND_PROJECTION_TEMPLATES } from "@dpf/db/federated-demand-contract";
import {
  isFederationRelationshipPreset,
  isFederationRole,
  isRoleAllowedForRelationship,
  type FederationRelationshipPreset,
  type FederationRole,
} from "@dpf/db/federation-link-types";
import { isPartnerStanding, type PartnerStanding } from "@dpf/db/federated-channel";

import {
  resolveLocalFederationAuthorityUrl,
  selfAuthorityUnreachableReason,
} from "@/lib/federation/self-authority";
import {
  ADMIN_PATH,
  assertManagePlatform,
  type ActionFailure,
} from "@/lib/actions/federation-links-shared";
import { confirmNearbyPairingOnTrust } from "@/lib/federation/confirm-nearby-pairing-on-trust";
import { persistOutgoingPairingSession } from "@/lib/federation/persist-outgoing-pairing-session";
import { resolveFederationSigningIdentity } from "@/lib/federation/demand-identity";
import {
  resolveNearbyCandidatePairing,
  type NearbyCandidatePairingVerdict,
} from "@/lib/federation/resolve-nearby-candidate-pairing";
import {
  approveFederationLinkLocal,
  issueFederationBootstrap,
  quarantineFederationLink,
  revokeFederationLink,
} from "@/lib/federation/enrollment";
import { enrollWithPeer, relayApprovalToPeer } from "@/lib/federation/outbound";
import {
  confirmNearbyPairingPeer,
  pollNearbyPairingPeer,
  requestNearbyPairing,
  summarizeNearbyPairingProjection,
} from "@/lib/federation/nearby-pairing";
import {
  approveIncomingNearbyPairing,
  denyIncomingNearbyPairing,
} from "@/lib/federation/nearby-pairing-service";
import { listNearbyFederationCandidates } from "@/lib/federation/nearby-candidates";
import { relationshipPresetForRole } from "@/lib/federation/demand-reconciliation";
import {
  findActiveIntroducedCandidate,
  type IntroductionExchangeDb,
} from "@/lib/federation/introduction-exchange";
import {
  assertEncryptionReadyForCredentialWrite,
  decryptSecret,
  encryptSecret,
} from "@/lib/govern/credential-crypto";
import { envFlagEnabled } from "@/lib/runtime/env-flags";


// ── Bootstrap (invitation) issuance ──────────────────────────────────────────

export type IssueFederationBootstrapActionResult =
  | { ok: true; tokenId: string; plaintext: string; prefix: string; expiresAt: string }
  | ActionFailure;

export async function issueFederationBootstrapAction(input: {
  relationshipPreset: string;
  offeredRole: string;
  ttlMs?: number;
}): Promise<IssueFederationBootstrapActionResult> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  if (
    !isFederationRelationshipPreset(input.relationshipPreset) ||
    !isFederationRole(input.offeredRole) ||
    !isRoleAllowedForRelationship(input.relationshipPreset, input.offeredRole)
  ) {
    return { ok: false, error: "invalid_input", message: "relationship preset and offered role do not match" };
  }
  const ttlMs = input.ttlMs;
  if (ttlMs !== undefined && (!Number.isFinite(ttlMs) || ttlMs <= 0)) {
    return { ok: false, error: "invalid_input", message: "ttlMs must be a positive number" };
  }
  try {
    const result = await issueFederationBootstrap({
      issuedByPrincipalId: gate.principalId,
      offeredRole: input.offeredRole as FederationRole,
      proposedProjection:
        DEMAND_PROJECTION_TEMPLATES[
          input.relationshipPreset as FederationRelationshipPreset
        ] as unknown as Record<string, unknown>,
      ...(ttlMs !== undefined ? { ttlMs } : {}),
    });
    revalidatePath(ADMIN_PATH);
    return {
      ok: true,
      tokenId: result.tokenId,
      plaintext: result.plaintext,
      prefix: result.prefix,
      expiresAt: result.expiresAt.toISOString(),
    };
  } catch (err) {
    return { ok: false, error: "internal_error", message: err instanceof Error ? err.message : "issuance failed" };
  }
}

// ── Lifecycle (approve-local / quarantine / revoke) ──────────────────────────

export type LinkLifecycleResult = { ok: true; linkId: string; linkState: string } | ActionFailure;

async function loadLink(linkId: string) {
  if (!linkId || typeof linkId !== "string") return null;
  return prisma.federationLink.findUnique({ where: { linkId }, select: { linkId: true, linkState: true } });
}

export async function approveFederationLinkAction(linkId: string): Promise<LinkLifecycleResult> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  const link = await loadLink(linkId);
  if (!link) return { ok: false, error: "not_found", message: "Federation link not found" };
  if (link.linkState === "revoked") {
    return { ok: false, error: "invalid_transition", message: "revoked links cannot be approved" };
  }
  try {
    const linkState = await approveFederationLinkLocal(linkId, gate.principalId);
    // Relay our approval to the peer so they flip their approvedAtPeer. Best-effort:
    // a relay failure must never fail our local approval (the peer can be re-notified).
    {
      const full = await prisma.federationLink.findUnique({
        where: { linkId },
        select: { linkId: true, peerAuthorityUrl: true, peerTokenEnc: true, role: true },
      });
      if (full?.peerTokenEnc) {
        try {
          await relayApprovalToPeer(full);
        } catch {
          /* best-effort relay */
        }
      }
    }
    revalidatePath(ADMIN_PATH);
    return { ok: true, linkId, linkState };
  } catch (err) {
    return { ok: false, error: "internal_error", message: err instanceof Error ? err.message : "approve failed" };
  }
}

export async function quarantineFederationLinkAction(
  linkId: string,
  reason: string,
): Promise<LinkLifecycleResult> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  if (!reason || typeof reason !== "string" || !reason.trim()) {
    return { ok: false, error: "invalid_input", message: "quarantine reason required" };
  }
  const link = await loadLink(linkId);
  if (!link) return { ok: false, error: "not_found", message: "Federation link not found" };
  if (link.linkState === "revoked") {
    return { ok: false, error: "invalid_transition", message: "revoked links cannot be quarantined" };
  }
  try {
    const linkState = await quarantineFederationLink(linkId, reason.trim());
    revalidatePath(ADMIN_PATH);
    return { ok: true, linkId, linkState };
  } catch (err) {
    return { ok: false, error: "internal_error", message: err instanceof Error ? err.message : "quarantine failed" };
  }
}

export async function revokeFederationLinkAction(
  linkId: string,
  reason: string,
): Promise<LinkLifecycleResult> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  if (!reason || typeof reason !== "string" || !reason.trim()) {
    return { ok: false, error: "invalid_input", message: "revocation reason required" };
  }
  const link = await loadLink(linkId);
  if (!link) return { ok: false, error: "not_found", message: "Federation link not found" };
  if (link.linkState === "revoked") {
    return { ok: true, linkId, linkState: "revoked" }; // idempotent
  }
  try {
    const linkState = await revokeFederationLink(linkId, reason.trim());
    revalidatePath(ADMIN_PATH);
    return { ok: true, linkId, linkState };
  } catch (err) {
    return { ok: false, error: "internal_error", message: err instanceof Error ? err.message : "revoke failed" };
  }
}

// ── Founder Hub partner-business ownership ──────────────────────────────────

export type PartnerBusinessActionResult =
  | { ok: true; partnerId: string; standing: string }
  | ActionFailure;

function semanticId(prefix: string, value: string): string {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 16).toUpperCase()}`;
}

export async function enrollChannelPartnerAction(input: {
  linkId: string;
  displayName?: string;
  agreementReference?: string;
}): Promise<PartnerBusinessActionResult> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  if (!input.linkId?.trim()) {
    return { ok: false, error: "invalid_input", message: "Choose a channel connection." };
  }
  try {
    const [link, organization] = await Promise.all([
      prisma.federationLink.findUnique({
        where: { linkId: input.linkId.trim() },
        select: {
          linkId: true,
          role: true,
          linkState: true,
          peerOrganizationRef: true,
          principal: { select: { displayName: true } },
        },
      }),
      prisma.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }),
    ]);
    if (!link || !organization) {
      return { ok: false, error: "not_found", message: "Connection or local organization was not found." };
    }
    if (link.role !== "channel-upstream") {
      return { ok: false, error: "invalid_input", message: "Only an upstream channel connection can be enrolled as a Founder Hub reseller." };
    }
    if (link.linkState !== "trusted") {
      return { ok: false, error: "invalid_transition", message: "Both installations must approve the connection before enrollment." };
    }
    const externalOrganizationRef = link.peerOrganizationRef ?? `peer:${link.linkId}`;
    const partnerId = semanticId("PARTNER", `${organization.id}:${externalOrganizationRef}`);
    const partner = await prisma.partnerAccount.upsert({
      where: {
        organizationId_externalOrganizationRef: {
          organizationId: organization.id,
          externalOrganizationRef,
        },
      },
      create: {
        partnerId,
        organizationId: organization.id,
        federationLinkId: link.linkId,
        externalOrganizationRef,
        displayName: input.displayName?.trim() || link.principal.displayName,
        partnerKind: "reseller",
        standing: "pending",
        tier: "registered",
        enrolledAt: new Date(),
      },
      update: {
        federationLinkId: link.linkId,
        displayName: input.displayName?.trim() || link.principal.displayName,
      },
      select: { id: true, partnerId: true, standing: true },
    });
    if (input.agreementReference?.trim()) {
      const agreementReference = input.agreementReference.trim();
      await prisma.partnerAgreement.upsert({
        where: { agreementId: semanticId("PAGR", `${partner.partnerId}:${agreementReference}`) },
        create: {
          agreementId: semanticId("PAGR", `${partner.partnerId}:${agreementReference}`),
          partnerAccountId: partner.id,
          agreementType: "reseller",
          status: "active",
          externalReference: agreementReference,
          effectiveFrom: new Date(),
        },
        update: { status: "active", externalReference: agreementReference },
      });
    }
    revalidatePath(ADMIN_PATH);
    return { ok: true, partnerId: partner.partnerId, standing: partner.standing };
  } catch (error) {
    return { ok: false, error: "internal_error", message: error instanceof Error ? error.message : "Partner enrollment failed" };
  }
}

export async function updateChannelPartnerStandingAction(
  partnerId: string,
  standing: string,
): Promise<PartnerBusinessActionResult> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  if (!partnerId?.trim() || !isPartnerStanding(standing)) {
    return { ok: false, error: "invalid_input", message: "Choose a valid partner and standing." };
  }
  try {
    const partner = await prisma.partnerAccount.update({
      where: { partnerId: partnerId.trim() },
      data: {
        standing: standing as PartnerStanding,
        reviewedAt: new Date(),
      },
      select: { partnerId: true, standing: true },
    });
    revalidatePath(ADMIN_PATH);
    return { ok: true, partnerId: partner.partnerId, standing: partner.standing };
  } catch (error) {
    return { ok: false, error: "internal_error", message: error instanceof Error ? error.message : "Partner update failed" };
  }
}

// ── Connect to a peer (outbound enroll) ──────────────────────────────────────

export type EnrollWithPeerActionResult =
  | { ok: true; linkId: string; linkState: string; role: string }
  | ActionFailure;

/** Redeem a peer's invitation token to establish our side of a link. The
 *  peer-issued link token is stored encrypted for outbound calls. */
export async function enrollWithPeerAction(input: {
  peerAuthorityUrl: string;
  bootstrapToken: string;
  displayName: string;
  peerOrganizationRef?: string | null;
}): Promise<EnrollWithPeerActionResult> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  if (!input.peerAuthorityUrl?.trim() || !input.bootstrapToken?.trim() || !input.displayName?.trim()) {
    return { ok: false, error: "invalid_input", message: "peer URL, invitation token, and a name are required" };
  }
  const localAuthorityUrl = await resolveLocalFederationAuthorityUrl();
  if (!localAuthorityUrl) {
    return { ok: false, error: "internal_error", message: "could not determine this installation's address to advertise to the peer" };
  }
  const unreachable = selfAuthorityUnreachableReason({
    selfAuthorityUrl: localAuthorityUrl,
    peerAuthorityUrl: input.peerAuthorityUrl.trim(),
  });
  if (unreachable) {
    return { ok: false, error: "invalid_input", message: unreachable };
  }
  try {
    const result = await enrollWithPeer({
      peerAuthorityUrl: input.peerAuthorityUrl.trim(),
      bootstrapToken: input.bootstrapToken.trim(),
      localAuthorityUrl,
      displayName: input.displayName.trim(),
      ...(input.peerOrganizationRef ? { peerOrganizationRef: input.peerOrganizationRef } : {}),
    });
    if (!result.ok) return { ok: false, error: "internal_error", message: result.message };
    revalidatePath(ADMIN_PATH);
    return { ok: true, linkId: result.linkId, linkState: result.linkState, role: result.role };
  } catch (err) {
    return { ok: false, error: "internal_error", message: err instanceof Error ? err.message : "enroll failed" };
  }
}

// ── Secure automatic nearby pairing ─────────────────────────────────────────

export type NearbyPairingActionResult =
  | {
      ok: true;
      pairingId: string;
      status: string;
      matchingCode: string;
      peerDisplayName: string;
      peerAuthorityUrl: string;
      expiresAt: string;
      projectionSummary: ReturnType<typeof summarizeNearbyPairingProjection>;
      linkId?: string;
      /**
       * What the evidence actually supports for this peer. `operator-confirmation`
       * means the SAS code still has to be confirmed by a human on both ends;
       * `pairingReason` says which fact could not be proved, so the screen can
       * tell the operator why instead of just asking.
       */
      pairingMode?: NearbyCandidatePairingVerdict["mode"];
      pairingReason?: NearbyCandidatePairingVerdict["reason"];
      pairingExplanation?: string;
    }
  | ActionFailure;

export async function startNearbyPairingAction(input: {
  discoveryId: string;
  endpoint: string;
}): Promise<NearbyPairingActionResult> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  let candidate = listNearbyFederationCandidates().find(
    (row) => row.discoveryId === input.discoveryId && row.endpoint === input.endpoint,
  );
  if (!candidate) {
    candidate = await findActiveIntroducedCandidate(
      prisma as unknown as IntroductionExchangeDb,
      { introductionId: input.discoveryId, authorityUrl: input.endpoint },
    ) ?? undefined;
  }
  if (!candidate) {
    return { ok: false, error: "not_found", message: "That DPF candidate is no longer available. Wait for discovery or introductions to refresh." };
  }
  const offeredRole: FederationRole = candidate.source === "introducer"
    && candidate.relationshipHint
    && isFederationRole(candidate.relationshipHint)
    ? candidate.relationshipHint
    : "same-org-peer";
  const relationshipPreset = relationshipPresetForRole(offeredRole);
  if (!relationshipPreset || !isRoleAllowedForRelationship(relationshipPreset, offeredRole)) {
    return { ok: false, error: "invalid_input", message: "The introduced relationship policy is not supported for pairing." };
  }
  // Actually perform the check the candidate's readiness state has always only
  // NAMED. `nearby-candidates` sets `tls-validation-required` from the URL scheme
  // alone; until now nothing validated anything, so an https peer went straight
  // to pairing unexamined and every other peer got one hardcoded sentence.
  //
  // This does not gate the manual path: `operator-confirmation` still proceeds to
  // the SAS exchange exactly as before. It replaces a guess about the transport
  // with the real decision, and carries the reason back so the screen can say
  // which fact could not be proved.
  const pairing = await resolveNearbyCandidatePairing({
    endpoint: candidate.endpoint,
    secure: candidate.automaticPairing !== "blocked-insecure-transport",
    relationshipPreset,
    role: offeredRole,
    peerOrganizationRef: candidate.organizationRef ?? null,
  });
  if (pairing.reason === "insecure-transport") {
    return {
      ok: false,
      error: "invalid_input",
      message: `${pairing.explanation} Use a manual invitation until this installation has a trusted certificate.`,
    };
  }
  const localAuthorityUrl = await resolveLocalFederationAuthorityUrl();
  if (!localAuthorityUrl) {
    return { ok: false, error: "internal_error", message: "could not determine this installation's address to advertise to the peer" };
  }
  const unreachable = selfAuthorityUnreachableReason({
    selfAuthorityUrl: localAuthorityUrl,
    peerAuthorityUrl: candidate.endpoint,
  });
  if (unreachable) {
    return { ok: false, error: "invalid_input", message: unreachable };
  }
  try {
    await assertEncryptionReadyForCredentialWrite();
    const now = new Date();
    const existing = await prisma.federationPairingSession.findFirst({
      where: {
        direction: "outgoing",
        candidateDiscoveryId: candidate.discoveryId,
        peerAuthorityUrl: candidate.endpoint,
        status: { in: ["pending", "approved"] },
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      return {
        ok: true,
        pairingId: existing.pairingId,
        status: existing.status,
        matchingCode: existing.matchingCode,
        peerDisplayName: existing.peerDisplayName,
        peerAuthorityUrl: existing.peerAuthorityUrl,
        expiresAt: existing.expiresAt.toISOString(),
        projectionSummary: summarizeNearbyPairingProjection(
          isFederationRelationshipPreset(existing.relationshipPreset)
            ? existing.relationshipPreset
            : "same-organization",
        ),
        pairingMode: pairing.mode,
        ...(pairing.reason ? { pairingReason: pairing.reason } : {}),
        pairingExplanation: pairing.explanation,
      };
    }
    const [identity, organization] = await Promise.all([
      resolveFederationSigningIdentity(prisma),
      prisma.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
    ]);
    const displayName = organization?.name?.trim() || "Nearby DPF installation";
    const requested = await requestNearbyPairing({
      candidateEndpoint: candidate.endpoint,
      requesterAuthorityUrl: localAuthorityUrl,
      displayName,
      requesterInstallationId: identity.installationId,
      candidateDiscoveryId: candidate.discoveryId,
      requesterIdentity: identity,
      relationshipPreset,
      offeredRole,
    });
    if (!requested.ok) {
      return { ok: false, error: "internal_error", message: requested.message };
    }
    const remoteExpiry = new Date(requested.expiresAt);
    const expiresAt = new Date(Math.min(remoteExpiry.getTime(), now.getTime() + 15 * 60_000));
    await persistOutgoingPairingSession({
      requested,
      relationshipPreset,
      offeredRole,
      localDeviceId: identity.deviceId,
      localSigningPublicKey: identity.signingPublicKey,
      peerAuthorityUrl: candidate.endpoint,
      candidateDiscoveryId: candidate.discoveryId,
      requestedAt: now,
      expiresAt,
    });

    // Organization trust already authenticated this peer more strongly than six
    // digits can, so confirm on that evidence rather than waiting for a person.
    // Anything short of `auto-enroll` refuses inside, leaving the comparison.
    const trustConfirmation = await confirmNearbyPairingOnTrust({
      pairingId: requested.pairingId,
      verdict: pairing,
      candidateEndpoint: candidate.endpoint,
      peerOrganizationRef: candidate.organizationRef ?? null,
      pairingSecret: requested.pairingSecret,
      now,
    });

    revalidatePath(ADMIN_PATH);
    return {
      ok: true,
      pairingId: requested.pairingId,
      status: trustConfirmation.confirmed ? "pending-confirmation" : "pending",
      matchingCode: requested.matchingCode,
      peerDisplayName: requested.peerDisplayName,
      peerAuthorityUrl: candidate.endpoint,
      expiresAt: expiresAt.toISOString(),
      projectionSummary: requested.projectionSummary,
      pairingMode: pairing.mode,
      ...(pairing.reason ? { pairingReason: pairing.reason } : {}),
      pairingExplanation: pairing.explanation,
    };
  } catch (error) {
    return { ok: false, error: "internal_error", message: error instanceof Error ? error.message : "Nearby pairing failed." };
  }
}

export async function pollNearbyPairingAction(pairingId: string): Promise<NearbyPairingActionResult> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  const row = await prisma.federationPairingSession.findUnique({ where: { pairingId } });
  if (!row || row.direction !== "outgoing") {
    return { ok: false, error: "not_found", message: "Pairing session not found." };
  }
  const baseResult = {
    pairingId: row.pairingId,
    matchingCode: row.matchingCode,
    peerDisplayName: row.peerDisplayName,
    peerAuthorityUrl: row.peerAuthorityUrl,
    expiresAt: row.expiresAt.toISOString(),
    projectionSummary: summarizeNearbyPairingProjection(
      isFederationRelationshipPreset(row.relationshipPreset)
        ? row.relationshipPreset
        : "same-organization",
    ),
  };
  if (row.status === "consumed" || row.status === "denied" || row.status === "expired") {
    return { ok: true, ...baseResult, status: row.status };
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    await prisma.federationPairingSession.update({
      where: { id: row.id },
      data: { status: "expired", pairingSecretEnc: null },
    });
    return { ok: true, ...baseResult, status: "expired" };
  }
  if (!row.pairingSecretEnc) {
    return { ok: false, error: "internal_error", message: "Stored pairing credential is unavailable." };
  }
  const pairingSecret = decryptSecret(row.pairingSecretEnc);
  if (!pairingSecret) {
    return { ok: false, error: "internal_error", message: "Stored pairing credential could not be decrypted." };
  }
  const peer = await pollNearbyPairingPeer({
    candidateEndpoint: row.peerAuthorityUrl,
    pairingId: row.pairingId,
    pairingSecret,
  });
  if (!peer.ok) return { ok: false, error: "internal_error", message: peer.message };
  if (peer.status !== "approved") {
    await prisma.federationPairingSession.update({
      where: { id: row.id },
      data: {
        status: peer.status,
        ...(peer.status === "pending" ? {} : { pairingSecretEnc: null }),
        lastPolledAt: new Date(),
        pollCount: { increment: 1 },
      },
    });
    revalidatePath(ADMIN_PATH);
    return { ok: true, ...baseResult, status: peer.status };
  }
  const [localAuthorityUrl, organization] = await Promise.all([
    resolveLocalFederationAuthorityUrl(),
    prisma.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
  ]);
  if (!localAuthorityUrl) {
    return { ok: false, error: "internal_error", message: "This installation's base URL is not configured." };
  }
  const enrolled = await enrollWithPeer({
    peerAuthorityUrl: row.peerAuthorityUrl,
    bootstrapToken: peer.bootstrapToken,
    localAuthorityUrl,
    displayName: organization?.name?.trim() || "Nearby DPF installation",
    localOrganizationId: organization?.id ?? null,
    peerOrganizationRef: row.peerInstallationId,
    localDeviceId: ((row.sasState ?? {}) as { localDeviceId?: string }).localDeviceId ?? null,
    peerDeviceId: ((row.sasState ?? {}) as { remoteDeviceId?: string }).remoteDeviceId ?? null,
  });
  if (!enrolled.ok) {
    return { ok: false, error: "internal_error", message: enrolled.message };
  }
  const consumedAt = new Date();
  const candidateSelectors = [
    ...(row.candidateDiscoveryId ? [{ introductionId: row.candidateDiscoveryId }] : []),
    ...(row.peerInstallationId ? [{ installationId: row.peerInstallationId }] : []),
  ];
  await prisma.$transaction(async (tx) => {
    await tx.federationPairingSession.update({
      where: { id: row.id },
      data: {
        status: "consumed",
        consumedAt,
        pairingSecretEnc: null,
        lastPolledAt: consumedAt,
        pollCount: { increment: 1 },
      },
    });
    if (candidateSelectors.length > 0) {
      await tx.federationIntroductionCandidate.updateMany({
        where: { OR: candidateSelectors, pairedFederationLinkId: null },
        data: { pairedFederationLinkId: enrolled.linkId },
      });
    }
  });
  revalidatePath(ADMIN_PATH);
  return { ok: true, ...baseResult, status: "consumed", linkId: enrolled.linkId };
}

export async function approveNearbyPairingAction(pairingId: string): Promise<
  { ok: true; status: "approved" | "pending-confirmation" } | ActionFailure
> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  const result = await approveIncomingNearbyPairing({ pairingId, approverPrincipalId: gate.principalId });
  if (!result.ok) {
    return {
      ok: false,
      error: result.error === "not_found" ? "not_found" : "invalid_transition",
      message: result.error === "expired" ? "Pairing request expired." : "Pairing request cannot be approved.",
    };
  }
  revalidatePath(ADMIN_PATH);
  return result;
}

export async function confirmNearbyPairingAction(pairingId: string): Promise<
  { ok: true; status: "approved" | "pending-confirmation" } | ActionFailure
> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  const row = await prisma.federationPairingSession.findUnique({ where: { pairingId } });
  if (
    !row ||
    row.direction !== "outgoing" ||
    row.status !== "pending" ||
    !/^\d{6}$/.test(row.matchingCode) ||
    row.expiresAt.getTime() <= Date.now()
  ) return { ok: false, error: "invalid_transition", message: "Pairing code cannot be confirmed." };
  if (!row.pairingSecretEnc) {
    return { ok: false, error: "internal_error", message: "Stored pairing credential is unavailable." };
  }
  const pairingSecret = decryptSecret(row.pairingSecretEnc);
  if (!pairingSecret) {
    return { ok: false, error: "internal_error", message: "Stored pairing credential could not be decrypted." };
  }
  const peer = await confirmNearbyPairingPeer({
    candidateEndpoint: row.peerAuthorityUrl,
    pairingId: row.pairingId,
    pairingSecret,
  });
  if (!peer.ok) return { ok: false, error: "internal_error", message: peer.message };
  await prisma.federationPairingSession.update({
    where: { id: row.id },
    data: { sasConfirmedAtLocal: new Date() },
  });
  revalidatePath(ADMIN_PATH);
  return { ok: true, status: peer.status };
}

export async function denyNearbyPairingAction(pairingId: string, reason: string): Promise<
  { ok: true; status: "denied" } | ActionFailure
> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  const result = await denyIncomingNearbyPairing({
    pairingId,
    deniedByPrincipalId: gate.principalId,
    reason,
  });
  if (!result.ok) {
    return {
      ok: false,
      error: result.error === "invalid_input" ? "invalid_input" : "invalid_transition",
      message: result.error === "invalid_input" ? "A denial reason is required." : "Pairing request cannot be denied.",
    };
  }
  revalidatePath(ADMIN_PATH);
  return result;
}

export type SetFederationDiscoveryActionResult =
  | { ok: true; updated: number; enabled: boolean }
  | ActionFailure;

/** Authority-owned kill switch for native nearby discovery. Existing Edge
 * nodes advertise support through heartbeat; this action decides whether the
 * capability is accepted. */
export async function setFederationDiscoveryEnabledAction(
  enabled: boolean,
): Promise<SetFederationDiscoveryActionResult> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  const rows = await prisma.edgeNodeCapability.findMany({
    where: {
      capability: "federation.discovery",
      node: { installMode: "native", trustState: "trusted", revokedAt: null },
    },
    select: { id: true },
  });
  if (rows.length === 0) {
    return {
      ok: false,
      error: "not_found",
      message: "No trusted native Edge Node has registered nearby discovery yet",
    };
  }
  const result = await prisma.edgeNodeCapability.updateMany({
    where: { id: { in: rows.map((row) => row.id) } },
    data: { mode: enabled ? "enabled" : "disabled" },
  });
  revalidatePath(ADMIN_PATH);
  revalidatePath("/platform/edge-nodes");
  return { ok: true, updated: result.count, enabled };
}

export async function setFederationLinkEnvironmentAction(
  linkId: string,
  environmentClass: "production" | "development" | "test",
): Promise<{ ok: true; environmentClass: string } | ActionFailure> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  if (!linkId?.trim() || !["production", "development", "test"].includes(environmentClass)) {
    return { ok: false, error: "invalid_input", message: "Choose production, development, or test." };
  }
  const link = await prisma.federationLink.findUnique({ where: { linkId: linkId.trim() }, select: { metadata: true } });
  if (!link) return { ok: false, error: "not_found", message: "Connection not found." };
  const metadata = link.metadata && typeof link.metadata === "object" && !Array.isArray(link.metadata)
    ? link.metadata as Record<string, unknown>
    : {};
  await prisma.federationLink.update({
    where: { linkId: linkId.trim() },
    data: { metadata: { ...metadata, environmentClass } },
  });
  revalidatePath(ADMIN_PATH);
  revalidatePath("/ops/demand");
  return { ok: true, environmentClass };
}

export async function setFederationIntroducerPolicyAction(
  linkId: string,
  policy: { offersIntroductions: boolean; acceptsIntroductions: boolean },
): Promise<{ ok: true; offersIntroductions: boolean; acceptsIntroductions: boolean } | ActionFailure> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  const link = await prisma.federationLink.findUnique({ where: { linkId: linkId.trim() } });
  if (!link) return { ok: false, error: "not_found", message: "Federation link not found." };
  if (link.linkState !== "trusted" || link.revokedAt || link.quarantinedAt) {
    return { ok: false, error: "invalid_transition", message: "Introductions require an active trusted connection." };
  }
  await prisma.federationLink.update({
    where: { linkId: link.linkId },
    data: policy,
  });
  revalidatePath(ADMIN_PATH);
  return { ok: true, ...policy };
}
