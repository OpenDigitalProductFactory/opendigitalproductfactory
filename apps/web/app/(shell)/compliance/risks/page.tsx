import { listRiskAssessments } from "@/lib/actions/compliance";
import { RISK_LEVELS } from "@/lib/compliance-types";
import Link from "next/link";
import { CreateRiskAssessmentForm } from "@/components/compliance/CreateRiskAssessmentForm";

const RISK_COLORS: Record<string, string> = {
  low: "bg-green-900/30 text-green-400",
  medium: "bg-yellow-900/30 text-yellow-400",
  high: "bg-orange-900/30 text-orange-400",
  critical: "bg-red-900/30 text-red-400",
};

type Props = { searchParams: Promise<{ inherentRisk?: string; status?: string }> };

export default async function RisksPage({ searchParams }: Props) {
  const sp = await searchParams;
  const filters = {
    ...(sp.inherentRisk && { inherentRisk: sp.inherentRisk }),
    ...(sp.status && { status: sp.status }),
  };
  const hasFilters = Object.keys(filters).length > 0;
  const risks = await listRiskAssessments(hasFilters ? filters : undefined);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Risk Assessments</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">{risks.length} active</p>
        </div>
        <CreateRiskAssessmentForm />
      </div>

      {/* Filter bar */}
      <form className="flex flex-wrap gap-3 mb-6">
        <select name="inherentRisk" defaultValue={sp.inherentRisk ?? ""}
          className="text-xs px-2 py-1.5 rounded-md border border-[var(--dpf-border)] bg-[#1a1a1a] text-white focus:outline-none focus:border-[var(--dpf-accent)]">
          <option value="">All risk levels</option>
          {RISK_LEVELS.map((l) => (
            <option key={l} value={l}>{l.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</option>
          ))}
        </select>

        <select name="status" defaultValue={sp.status ?? ""}
          className="text-xs px-2 py-1.5 rounded-md border border-[var(--dpf-border)] bg-[#1a1a1a] text-white focus:outline-none focus:border-[var(--dpf-accent)]">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>

        <button type="submit"
          className="text-xs px-3 py-1.5 rounded-md bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity">
          Filter
        </button>

        {hasFilters && (
          <Link href="/compliance/risks"
            className="text-xs px-3 py-1.5 rounded-md border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-white transition-colors">
            Clear
          </Link>
        )}
      </form>

      {risks.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No risk assessments match the current filters.</p>
      ) : (
        <div className="space-y-2">
          {risks.map((r) => (
            <Link key={r.id} href={`/compliance/risks/${r.id}`} className="block p-3 rounded-lg border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] transition-colors">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-sm text-white">{r.title}</span>
                  <div className="flex gap-2 mt-1">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${RISK_COLORS[r.inherentRisk] ?? "bg-gray-900/30 text-gray-400"}`}>
                      Inherent: {r.inherentRisk}
                    </span>
                    {r.residualRisk && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${RISK_COLORS[r.residualRisk] ?? "bg-gray-900/30 text-gray-400"}`}>
                        Residual: {r.residualRisk}
                      </span>
                    )}
                    <span className="text-[9px] text-[var(--dpf-muted)]">{r.likelihood} / {r.severity}</span>
                  </div>
                </div>
                <div className="text-right text-xs text-[var(--dpf-muted)]">
                  <p>{r._count.controls} control{r._count.controls !== 1 ? "s" : ""}</p>
                  <p>{r._count.incidents} incident{r._count.incidents !== 1 ? "s" : ""}</p>
                  {r.assessedBy && <p>{r.assessedBy.displayName}</p>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
