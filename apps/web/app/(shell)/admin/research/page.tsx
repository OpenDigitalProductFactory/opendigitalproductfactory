import { listPendingResearchProposalsAction } from "@/lib/actions/research-proposals";
import { ResearchProposalsPanel } from "@/components/admin/ResearchProposalsPanel";

// Admin surface for scheduled AI research proposals (BI-8A58C65A slice E).
export default async function ResearchProposalsPage() {
  const pending = await listPendingResearchProposalsAction();

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-[var(--dpf-text)]">Research proposals</h2>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Scheduled AI research about your market. Approve a proposal to run it — results land as a
          draft in your organization&apos;s knowledge for review.
        </p>
      </div>
      <ResearchProposalsPanel initial={pending} />
    </div>
  );
}
