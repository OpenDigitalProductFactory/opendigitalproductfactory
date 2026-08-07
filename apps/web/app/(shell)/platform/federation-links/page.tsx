import { redirect } from "next/navigation";

import { prisma } from "@dpf/db";
import { isFederationPairingDirection } from "@dpf/db/federation-pairing-types";
import { resolveIncidentProjectionSpec } from "@dpf/db/projection-egress";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listNearbyFederationCandidates } from "@/lib/federation/nearby-candidates";
import { summarizeNearbyPairingProjection } from "@/lib/federation/nearby-pairing";
import { resolveFounderDemandEnvironment } from "@dpf/db/founder-shared-portfolio";
import {
  FederationLinksAdminClient,
  type FederationLinkRow,
  type NearbyDiscoveryHealth,
  type NearbyPairingRow,
} from "@/components/platform/federation-links/FederationLinksAdminClient";
import {
  PartnerBusinessPanel,
  type PartnerBusinessRow,
} from "@/components/platform/federation-links/PartnerBusinessPanel";
import { OrganizationJoinPanel } from "@/components/platform/federation-links/OrganizationJoinPanel";
import { ConnectionReadinessCard } from "@/components/platform/federation-links/ConnectionReadinessCard";
import { computeConnectionReadiness } from "@/lib/federation/connection-readiness";
import { getOrganizationJoinNodeSummariesAction } from "@/lib/actions/organization-join";

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

  const [links, discoveryCapabilities, partnerAccounts, nearbyPairingSessions, organizationJoinNodes] = await Promise.all([
    prisma.federationLink.findMany({
      include: { principal: { select: { displayName: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.edgeNodeCapability.findMany({
      where: { capability: "federation.discovery" },
      select: {
        mode: true,
        status: true,
        reportedAt: true,
        node: { select: { trustState: true, status: true } },
      },
      orderBy: { reportedAt: "desc" },
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
    getOrganizationJoinNodeSummariesAction(),
  ]);

  const enabledDiscovery = discoveryCapabilities.filter(
    (row) =>
      (row.mode === "enabled" || row.mode === "reporting-only") &&
      row.node.trustState === "trusted",
  );
  const nearbyDiscoveryHealth: NearbyDiscoveryHealth =
    discoveryCapabilities.length === 0
      ? {
          status: "unavailable",
          label: "Not set up",
          detail: "The native Edge Node has not registered nearby discovery.",
        }
      : enabledDiscovery.length === 0
        ? {
            status: "disabled",
            label: "Paused",
            detail: "Nearby discovery is disabled by the Authority.",
          }
        : enabledDiscovery.some((row) => row.status === "healthy")
          ? {
              status: "healthy",
              label: "Listening",
              detail: "This installation is announcing and looking for nearby DPF installations.",
            }
          : enabledDiscovery.some(
                (row) => row.status === "degraded" || row.status === "failing",
              )
            ? {
                status: "degraded",
                label: "Needs attention",
                detail: "Nearby discovery is enabled but cannot advertise or browse. Check the endpoint configuration, multicast network, and host firewall.",
              }
            : {
                status: "waiting",
                label: "Starting",
                detail: "Nearby discovery is enabled and waiting for its first health report.",
              };

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
  const nearbyProjection = summarizeNearbyPairingProjection();
  const nearbyPairings: NearbyPairingRow[] = nearbyPairingSessions.flatMap((pairing) =>
    isFederationPairingDirection(pairing.direction)
      ? [{
          pairingId: pairing.pairingId,
          direction: pairing.direction,
          status: pairing.status,
          matchingCode: pairing.matchingCode,
          peerDisplayName: pairing.peerDisplayName,
          peerAuthorityUrl: pairing.peerAuthorityUrl,
          expiresAt: pairing.expiresAt.toISOString(),
          sharedSlices: nearbyProjection.sharedSlices,
          retentionClass: nearbyProjection.retentionClass,
          staysLocal: nearbyProjection.staysLocal,
        }]
      : [],
  );
  const enrolledLinkIds = new Set(partnerAccounts.flatMap((partner) => partner.federationLinkId ? [partner.federationLinkId] : []));
  const eligiblePartnerLinks = links
    .filter((link) => link.role === "channel-upstream" && link.linkState === "trusted" && !enrolledLinkIds.has(link.linkId))
    .map((link) => ({ linkId: link.linkId, displayName: link.principal.displayName }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Connections</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Find nearby DPF installations or connect with an invitation. Nothing is shared until
          both sides approve; either side can pause or revoke the connection.
        </p>
      </div>
      <ConnectionReadinessCard readiness={computeConnectionReadiness(process.env)} />
      <OrganizationJoinPanel nodes={organizationJoinNodes.ok ? organizationJoinNodes.nodes : []} />
      <FederationLinksAdminClient
        rows={rows}
        nearbyCandidates={listNearbyFederationCandidates()}
        nearbyPairings={nearbyPairings}
        nearbyDiscoveryHealth={nearbyDiscoveryHealth}
      />
      <PartnerBusinessPanel partners={partners} eligibleLinks={eligiblePartnerLinks} />
    </div>
  );
}
