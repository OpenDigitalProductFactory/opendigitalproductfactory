// apps/web/app/(shell)/ops/page.tsx
import { getBacklogItems, getDigitalProductsForSelect, getTaxonomyNodesFlat, getEpics, getPortfoliosForSelect } from "@/lib/backlog-data";
import { reconcileImprovementBacklog } from "@/lib/evaluate/improvement-backlog-reconcile";
import { reconcileCapabilityNeedBacklog } from "@/lib/coworker-self-assessment/capability-backlog-reconcile";
import { getOpenEscalations } from "@/lib/quality/escalation-attention";
import { OpsClient } from "@/components/ops/OpsClient";
import { OpsTabNav } from "@/components/ops/OpsTabNav";
import { EscalationsAttention } from "@/components/ops/EscalationsAttention";
import { SurfaceViewSwitcher } from "@/components/workbooks/SurfaceViewSwitcher";
import { SurfacePlatformGrid } from "@/components/workbooks/SurfacePlatformGrid";

export const dynamic = "force-dynamic";

type Props = {
  searchParams?: Promise<{ itemId?: string; view?: string; origin?: string }>;
};

export default async function OpsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const rawView = sp?.view;
  const view = rawView === "grid" || rawView === "board" ? rawView : null;

  // Surface convergence (EP-INTAKE-UNIFY, operator directive 2026-06-20): /ops is
  // the ONE place every source is seen + worked, so it now owns the idempotent
  // backfill the retired origin pages used to run on render — every improvement /
  // capability need is guaranteed in the backlog. Non-fatal; zero-write once
  // converged.
  await Promise.all([
    reconcileImprovementBacklog().catch(() => {}),
    reconcileCapabilityNeedBacklog().catch(() => {}),
  ]);

  const [items, digitalProducts, taxonomyNodes, epics, portfolios, escalations] = await Promise.all([
    getBacklogItems(),
    getDigitalProductsForSelect(),
    getTaxonomyNodesFlat(),
    getEpics(),
    getPortfoliosForSelect(),
    // Surface convergence (BI-0ACD9AB2): self-fix escalations held for a responder
    // are attended HERE, in the one operator surface — not a separate /admin queue.
    getOpenEscalations().catch(() => []),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Operations</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {epics.length} epic{epics.length !== 1 ? "s" : ""} · {items.length} item{items.length !== 1 ? "s" : ""}
        </p>
      </div>

      <OpsTabNav />

      <EscalationsAttention escalations={escalations} />

      <SurfaceViewSwitcher entityType="backlog_item" current={view ?? "list"} />

      {view ? (
        <SurfacePlatformGrid entityType="backlog_item" view={view} />
      ) : (
        <OpsClient
          items={items}
          digitalProducts={digitalProducts}
          taxonomyNodes={taxonomyNodes}
          epics={epics}
          portfolios={portfolios}
          focusedItemId={sp?.itemId}
          initialOrigin={sp?.origin}
        />
      )}
    </div>
  );
}
