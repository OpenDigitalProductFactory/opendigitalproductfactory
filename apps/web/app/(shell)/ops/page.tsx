// apps/web/app/(shell)/ops/page.tsx
import { getBacklogItems, getDigitalProductsForSelect, getTaxonomyNodesFlat, getEpics, getPortfoliosForSelect } from "@/lib/backlog-data";
import { reconcileImprovementBacklog } from "@/lib/evaluate/improvement-backlog-reconcile";
import { reconcileCapabilityNeedBacklog } from "@/lib/coworker-self-assessment/capability-backlog-reconcile";
import { runEscalationHygiene } from "@/lib/quality/escalation-hygiene-runner";
import { OpsClient } from "@/components/ops/OpsClient";
import { OpsTabNav } from "@/components/ops/OpsTabNav";
import { auth } from "@/lib/auth";
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
    // BI-467E8F8D: clear stale build-stall escalations so the queue stays trustworthy
    // without waiting for the 15-min cron. The escalation BAND moved to the /workspace
    // "Needs you" inbox (EP-ATTENTION-SURFACE: attention ≠ backlog); the hygiene stays
    // here too since /ops still reconciles work. Non-fatal; zero-write once converged.
    runEscalationHygiene().catch(() => {}),
  ]);

  const [items, digitalProducts, taxonomyNodes, epics, portfolios, session] = await Promise.all([
    getBacklogItems().catch(() => []),
    getDigitalProductsForSelect().catch(() => []),
    getTaxonomyNodesFlat().catch(() => []),
    getEpics().catch(() => []),
    getPortfoliosForSelect().catch(() => []),
    auth().catch(() => null),
  ]);
  // Current operator — resolves the "mine" scope in the Needs-you-next band
  // (BI-01CC2356). Optional: the band degrades to an urgency-only split when absent.
  const currentUserId = session?.user?.id ?? undefined;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Operations</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {epics.length} epic{epics.length !== 1 ? "s" : ""} · {items.length} item{items.length !== 1 ? "s" : ""}
        </p>
      </div>

      <OpsTabNav />

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
          currentUserId={currentUserId}
        />
      )}
    </div>
  );
}
