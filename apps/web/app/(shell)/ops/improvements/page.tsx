// apps/web/app/(shell)/ops/improvements/page.tsx
import { getImprovementProposals, getImprovementCounts } from "@/lib/improvement-data";
import { ImprovementsClient } from "@/components/ops/ImprovementsClient";
import { OpsTabNav } from "@/components/ops/OpsTabNav";

export default async function ImprovementsPage() {
  const [proposals, counts] = await Promise.all([
    getImprovementProposals(),
    getImprovementCounts(),
  ]);

  const total = proposals.length;
  const actionable = (counts["proposed"] ?? 0) + (counts["reviewed"] ?? 0);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Operations</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {total} improvement{total !== 1 ? "s" : ""}
          {actionable > 0 ? ` · ${actionable} need${actionable !== 1 ? "" : "s"} attention` : ""}
        </p>
      </div>

      <OpsTabNav />

      <ImprovementsClient proposals={proposals} />
    </div>
  );
}
