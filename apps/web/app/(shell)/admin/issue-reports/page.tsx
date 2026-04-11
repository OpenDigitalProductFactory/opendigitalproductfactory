import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { IssueReportPanel } from "@/components/admin/IssueReportPanel";
import { getIssueReports, getIssueReportStats } from "@/lib/actions/quality";

export default async function AdminIssueReportsPage() {
  const [data, stats] = await Promise.all([
    getIssueReports(),
    getIssueReportStats(),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Admin</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Issue Reports — {data.total} total
        </p>
      </div>

      <AdminTabNav />

      <IssueReportPanel
        items={JSON.parse(JSON.stringify(data.items))}
        total={data.total}
        stats={JSON.parse(JSON.stringify(stats))}
      />
    </div>
  );
}
