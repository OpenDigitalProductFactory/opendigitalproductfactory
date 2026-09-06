import { redirect } from "next/navigation";

import { prisma } from "@dpf/db";
import { isFederationPairingDirection } from "@dpf/db/federation-pairing-types";
import { isFederationRelationshipPreset } from "@dpf/db/federation-link-types";
import { resolveIncidentProjectionSpec } from "@dpf/db/projection-egress";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listNearbyFederationCandidates } from "@/lib/federation/nearby-candidates";
import { summarizeNearbyPairingProjection } from "@/lib/federation/nearby-pairing";
import { resolveFounderDemandEnvironment } from "@dpf/db/founder-shared-portfolio";
import {
  FederationLinksAdminClient,
  type FederationLinkRow,
  type NearbyPairingRow,
} from "@/components/platform/federation-links/FederationLinksAdminClient";
import {
  PartnerBusinessPanel,
  type PartnerBusinessRow,
} from "@/components/platform/federation-links/PartnerBusinessPanel";
import { OrganizationJoinPanel } from "@/components/platform/federation-links/OrganizationJoinPanel";
import {
  deriveNearbyDiscoveryHealth,
  deriveEdgeNodeReadiness,
  selectMainInstallationNode,
  type EdgeReadinessNode,
} from "@/lib/edge-node/readiness";

export const dynamic = "force-dynamic";

// EP-MSP-FEDERATION · B1 operator surface — Platform > Connections.
// Lists sovereign-peer trust channels and lets an operator issue invitations and
// approve / quarantine / revoke links. Mirrors the Edge Nodes admin.
export default async function FederationLinksPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?next=/platform/federation-links");
  if (
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "manage_platform",
    )
  ) {
    redirect("/403");
  }

  const [links, edgeNodes, partnerAccounts, nearbyPairingSessions, introducedCandidates] = await Promise.all([
    prisma.federationLink.findMany({
      include: { principal: { select: { displayName: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.edgeNode.findMany({
      select: {
        id: true, nodeId: true, platform: true, installMode: true, version: true,
        status: true, trustState: true, lastSeenAt: true, enrolledAt: true,
        customerAccountId: true, customerSiteId: true,
        consumedTokens: { select: { autoApprove: true } },
        capabilityRows: {
          select: { capability: true, mode: true, status: true, reportedAt: true },
        },
      },
    }),
    prisma.partnerAccount.findMany({
      include: {
        federationLink: { include: { principal: { select: { displayName: true } } } },
        agreements: { orderBy: { createdAt: "desc" }, take: 1 },
        _count: { select: { agreements: true, entitlements: true, supportRoutes: true, contributionRecognitions: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    prisma.federationPairingSession.findMany({
      where: {
        status: { in: ["pending", "approved"] },
        expiresAt: { gt: new Date() },
      },
      orderBy: { requestedAt: "desc" },
      take: 20,
    }),
    prisma.federationIntroductionCandidate.findMany({
      where: {
        expiresAt: { gt: new Date() }, withdrawnAt: null, dismissedAt: null,
        pairedFederationLinkId: null,
        introducerLink: { linkState: "trusted", acceptsIntroductions: true, revokedAt: null, quarantinedAt: null },
      },
      include: { introducerLink: { include: { principal: { select: { displayName: true } } } } },
      orderBy: { lastSeenAt: "desc" },
      take: 100,
    }),
  ]);

  const readinessNodes: EdgeReadinessNode[] = edgeNodes.map((node) => ({
    ...node,
    storedStatus: node.status,
    installerManaged: node.consumedTokens.some((token) => token.autoApprove),
    capabilities: node.capabilityRows,
  }));
  const mainNode = selectMainInstallationNode(readinessNodes);
  const discoveryCapability = mainNode.node?.capabilities.find(
    (row) => row.capability === "federation.discovery",
  );
  const readiness = mainNode.node
    ? deriveEdgeNodeReadiness(mainNode.node, { requiredCapabilities: ["federation.discovery"] })
    : null;
  const nearbyDiscoveryHealth = deriveNearbyDiscoveryHealth({
    selection: mainNode,
    readiness,
    discoveryCapability: discoveryCapability ?? null,
  });

  const rows: FederationLinkRow[] = links.map((l) => {
    // What crosses this link to the peer: the minimum-necessary projection the
    // egress gate (R5) enforces — the proposed projection if one was negotiated,
    // else the safe default. Surfaced so a (regulated) customer can SEE what is
    // shared with the MSP, not just trust that it is minimal.
    const meta = (l.metadata ?? {}) as Record<string, unknown>;
    const spec = resolveIncidentProjectionSpec(meta.proposedProjection);
    return {
      linkId: l.linkId,
      displayName: l.principal?.displayName ?? l.linkId,
      role: l.role,
      linkState: l.linkState,
      peerAuthorityUrl: l.peerAuthorityUrl,
      peerOrganizationRef: l.peerOrganizationRef,
      approvedLocal: l.approvedAtLocal != null,
      approvedPeer: l.approvedAtPeer != null,
      sharedSlices: spec.includeSlices,
      sharedRetention: spec.retentionClass ?? "short",
      environmentClass: resolveFounderDemandEnvironment(meta),
      offersIntroductions: l.offersIntroductions,
      acceptsIntroductions: l.acceptsIntroductions,
      createdAtISO: l.createdAt.toISOString(),
    };
  });

  const partners: PartnerBusinessRow[] = partnerAccounts.map((partner) => ({
    partnerId: partner.partnerId,
    displayName: partner.displayName,
    standing: partner.standing,
    tier: partner.tier,
    linkName: partner.federationLink?.principal.displayName ?? null,
    agreementReference: partner.agreements[0]?.externalReference ?? null,
    agreementCount: partner._count.agreements,
    entitlementCount: partner._count.entitlements,
    supportRouteCount: partner._count.supportRoutes,
    recognitionCount: partner._count.contributionRecognitions,
  }));
  const nearbyPairings: NearbyPairingRow[] = nearbyPairingSessions.flatMap((pairing) =>
    isFederationPairingDirection(pairing.direction)
      ? (() => {
          const projection = summarizeNearbyPairingProjection(
            isFederationRelationshipPreset(pairing.relationshipPreset)
              ? pairing.relationshipPreset
              : "same-organization",
          );
          return [{
          pairingId: pairing.pairingId,
          direction: pairing.direction,
          status: pairing.status,
          matchingCode: pairing.matchingCode,
          peerDisplayName: pairing.peerDisplayName,
          peerAuthorityUrl: pairing.peerAuthorityUrl,
          expiresAt: pairing.expiresAt.toISOString(),
          sharedSlices: projection.sharedSlices,
          retentionClass: projection.retentionClass,
          staysLocal: projection.staysLocal,
          sasConfirmedAtLocal: pairing.sasConfirmedAtLocal != null,
          sasConfirmedAtPeer: pairing.sasConfirmedAtPeer != null,
          }];
        })()
      : [],
  );
  const enrolledLinkIds = new Set(partnerAccounts.flatMap((partner) => partner.federationLinkId ? [partner.federationLinkId] : []));
  const eligiblePartnerLinks = links
    .filter((link) => link.role === "channel-upstream" && link.linkState === "trusted" && !enrolledLinkIds.has(link.linkId))
    .map((link) => ({ linkId: link.linkId, displayName: link.principal.displayName }));
  const connectionCandidates = [
    ...listNearbyFederationCandidates(),
    ...introducedCandidates.map((candidate) => ({
      discoveryId: candidate.introductionId,
      endpoint: candidate.authorityUrl,
      protocol: "1" as const,
      capabilityDigest: candidate.deviceId,
      pairPath: "/connect/pair" as const,
      displayName: candidate.displayName,
      source: "introducer" as const,
      introducedBy: candidate.introducerLink.principal.displayName,
      relationshipHint: candidate.relationshipHint,
      observedAt: candidate.lastSeenAt.toISOString(),
      expiresAt: candidate.expiresAt.toISOString(),
      automaticPairing: "tls-validation-required" as const,
    })),
  ];

  // Installations this authority may issue a join file for: the trusted
  // same-organization peers it already knows by address (BI-1F69D3F8).
  const joinCandidates = rows
    .filter((row) => row.role === "same-org-peer" && row.linkState === "trusted")
    .flatMap((row) => {
      try {
        const hostname = new URL(row.peerAuthorityUrl).hostname;
        return hostname ? [{ hostname, displayName: row.displayName }] : [];
      } catch {
        return [];
      }
    })
    .filter((candidate, index, all) => all.findIndex((other) => other.hostname === candidate.hostname) === index);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Connections</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Find nearby DPF installations or connect with an invitation. Nothing is shared until
          both sides approve; either side can pause or revoke the connection.
        </p>
      </div>
      <OrganizationJoinPanel candidates={joinCandidates} />
      <FederationLinksAdminClient
        rows={rows}
        nearbyCandidates={connectionCandidates}
        nearbyPairings={nearbyPairings}
        nearbyDiscoveryHealth={nearbyDiscoveryHealth}
      />
      <PartnerBusinessPanel partners={partners} eligibleLinks={eligiblePartnerLinks} />
    </div>
  );
}
