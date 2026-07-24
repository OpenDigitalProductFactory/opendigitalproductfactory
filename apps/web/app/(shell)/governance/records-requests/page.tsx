import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@dpf/db";
import { hasActiveOrgCapability } from "@/lib/storefront/org-capabilities.server";
import {
  RecordsRequestsPanel,
  type RecordsRequestRow,
} from "@/components/civic/RecordsRequestsPanel";

// Statutory records-request queue (BI-8D477188 Phase 3). Capability-gated on
// records-request (public-body archetypes).
export default async function RecordsRequestsPage() {
  if (!(await hasActiveOrgCapability("records-request"))) notFound();

  const requests = await prisma.recordsRequest.findMany({
    orderBy: [{ status: "asc" }, { responseDueAt: "asc" }],
    take: 100,
  });

  const rows: RecordsRequestRow[] = requests.map((r) => ({
    id: r.id,
    requestId: r.requestId,
    requesterName: r.requesterName,
    requesterEmail: r.requesterEmail,
    description: r.description,
    receivedAt: r.receivedAt.toISOString(),
    responseDueAt: r.responseDueAt.toISOString(),
    status: r.status,
    denialReason: r.denialReason,
  }));

  const open = rows.filter((r) => r.status === "submitted" || r.status === "in-progress").length;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">Records Requests</h1>
          <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
            {open} open · {rows.length} total · statutory deadlines tracked per request
          </p>
        </div>
        <Link
          href="/governance"
          className="rounded border border-[var(--dpf-border)] px-3 py-1.5 text-xs text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
        >
          Meetings
        </Link>
      </div>
      <RecordsRequestsPanel requests={rows} />
    </div>
  );
}
