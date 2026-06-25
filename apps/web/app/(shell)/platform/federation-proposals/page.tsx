import { redirect } from "next/navigation";

import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  FederationProposalsClient,
  type FederationProposalRow,
} from "@/components/platform/federation-proposals/FederationProposalsClient";

export const dynamic = "force-dynamic";

// EP-MSP-FEDERATION · B4 operator surface — Platform > Federation Proposals.
// Cross-org remediation proposals from managing peers; the customer decides.
// Approved actions execute on the customer's OWN runner (when EP-CTRL-5E21A4
// lands) — the MSP never gains standing execute rights.
export default async function FederationProposalsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?next=/platform/federation-proposals");
  if (
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "manage_platform",
    )
  ) {
    redirect("/403");
  }

  const proposals = await prisma.federatedRemediationProposal.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const rows: FederationProposalRow[] = proposals.map((p) => ({
    proposalId: p.proposalId,
    incidentKey: p.incidentKey,
    overallDecision: p.overallDecision,
    status: p.status,
    actionCount: Array.isArray(p.actions) ? (p.actions as unknown[]).length : 0,
    createdAtISO: p.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Federation Proposals</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Remediation proposals from managing peers. You decide; approved actions execute on your
          own runner. Anything above the agreed authority band needs your approval here.
        </p>
      </div>
      <FederationProposalsClient rows={rows} />
    </div>
  );
}
