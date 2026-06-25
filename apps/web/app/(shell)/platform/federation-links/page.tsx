import { redirect } from "next/navigation";

import { prisma } from "@dpf/db";
import { resolveIncidentProjectionSpec } from "@dpf/db/projection-egress";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  FederationLinksAdminClient,
  type FederationLinkRow,
} from "@/components/platform/federation-links/FederationLinksAdminClient";

export const dynamic = "force-dynamic";

// EP-MSP-FEDERATION · B1 operator surface — Platform > Federation Links.
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

  const links = await prisma.federationLink.findMany({
    include: { principal: { select: { displayName: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
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
      createdAtISO: l.createdAt.toISOString(),
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Federation Links</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Consented, dual-approved trust channels to peer DPF deployments. A link is
          trusted only when both sides approve; quarantine or revoke takes effect immediately.
        </p>
      </div>
      <FederationLinksAdminClient rows={rows} />
    </div>
  );
}
