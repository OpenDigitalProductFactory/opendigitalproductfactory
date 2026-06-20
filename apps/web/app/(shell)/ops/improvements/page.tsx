// apps/web/app/(shell)/ops/improvements/page.tsx
import { getImprovementProposals, summarizeImprovementEvidence } from "@/lib/evaluate/improvement-data";
import { reconcileImprovementBacklog } from "@/lib/evaluate/improvement-backlog-reconcile";
import { ImprovementsClient } from "@/components/ops/ImprovementsClient";
import { OpsTabNav } from "@/components/ops/OpsTabNav";

export default async function ImprovementsPage() {
  // Drain any orphaned proposal into the backlog before rendering. New proposals
  // auto-file at creation (propose_improvement); this backfills legacy / never-
  // filed ones so the Improvements view never shows untracked work. Idempotent
  // (zero writes once converged) and non-fatal so a backfill hiccup never blanks
  // the page. EP-INTAKE-UNIFY Phase 6 (BI-196693D6).
  await reconcileImprovementBacklog().catch(() => {});

  const proposals = await getImprovementProposals();
  const summary = summarizeImprovementEvidence(proposals);
  const inProgress = summary.byBacklogStatus["in-progress"] ?? 0;
  const done = summary.byBacklogStatus["done"] ?? 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Operations</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {summary.total} improvement{summary.total !== 1 ? "s" : ""}
          {summary.total > 0 ? ` · ${summary.tracked} tracked in the backlog` : ""}
          {inProgress > 0 ? ` · ${inProgress} in progress` : ""}
          {done > 0 ? ` · ${done} done` : ""}
        </p>
        <p className="text-xs text-[var(--dpf-muted)] mt-1">
          Evidence view — each proposal is auto-filed to the backlog for triage and
          prioritized there. The backlog is the one place work is tracked.
        </p>
      </div>

      <OpsTabNav />

      <ImprovementsClient proposals={proposals} />
    </div>
  );
}
