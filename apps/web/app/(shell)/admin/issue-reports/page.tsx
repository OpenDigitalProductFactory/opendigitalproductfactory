import Link from "next/link";
import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { IssueReportPanel } from "@/components/admin/IssueReportPanel";
import { getIssueReports, getIssueReportStats, getBacklogLinksForReports } from "@/lib/actions/quality";

export default async function AdminIssueReportsPage() {
  const [data, stats] = await Promise.all([
    getIssueReports(),
    getIssueReportStats(),
  ]);
  const backlogLinks = await getBacklogLinksForReports(
    data.items.map((r: { reportId: string }) => r.reportId),
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Admin</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Runtime evidence &amp; audit trail — {data.total} report{data.total === 1 ? "" : "s"}.
          Runtime faults project to a{" "}
          <Link href="/ops" className="text-[var(--dpf-accent)] hover:underline">
            backlog item
          </Link>
          {" "}(workType=bug) immediately on report. Self-fix escalations are held for a responder
          and attended in{" "}
          <Link href="/ops" className="text-[var(--dpf-accent)] hover:underline">
            Operations
          </Link>
          {" "}— this page is the evidence trail, not a queue to drain.
        </p>
      </div>

      <AdminTabNav />

      <IssueReportPanel
        items={JSON.parse(JSON.stringify(data.items))}
        total={data.total}
        stats={JSON.parse(JSON.stringify(stats))}
        backlogLinks={backlogLinks}
      />
    </div>
  );
}
