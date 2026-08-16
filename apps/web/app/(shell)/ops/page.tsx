// apps/web/app/(shell)/ops/page.tsx
import { getBacklogItems, getDigitalProductsForSelect, getTaxonomyNodesFlat, getEpics, getPortfoliosForSelect } from "@/lib/backlog-data";
import { reconcileImprovementBacklog } from "@/lib/evaluate/improvement-backlog-reconcile";
import { reconcileCapabilityNeedBacklog } from "@/lib/coworker-self-assessment/capability-backlog-reconcile";
import { runEscalationHygiene } from "@/lib/quality/escalation-hygiene-runner";
import { OpsClient } from "@/components/ops/OpsClient";
import { OpsTabNav } from "@/components/ops/OpsTabNav";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import {
  PlatformGridSection,
  parseSurfaceDataScope,
  parseSurfaceView,
} from "@/components/workbooks/PlatformGridSection";

export const dynamic = "force-dynamic";

type Props = {
  searchParams?: Promise<{ itemId?: string; view?: string; dataScope?: string; origin?: string }>;
};

function ignoreReadFailure(): undefined {
  return undefined;
}

function emptyReadResult(): never[] {
  return [];
}

function zeroReadResult(): number {
  return 0;
}

function nullReadResult(): null {
  return null;
}

export default async function OpsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const view = parseSurfaceView(sp?.view);
  const dataScope = parseSurfaceDataScope(sp?.dataScope);

  // Surface convergence (EP-INTAKE-UNIFY, operator directive 2026-06-20): /ops is
  // the ONE place every source is seen + worked, so it now owns the idempotent
  // backfill the retired origin pages used to run on render — every improvement /
  // capability need is guaranteed in the backlog. Non-fatal; zero-write once
  // converged.
  await Promise.all([
    reconcileImprovementBacklog().catch(ignoreReadFailure),
    reconcileCapabilityNeedBacklog().catch(ignoreReadFailure),
    // BI-467E8F8D: clear stale build-stall escalations so the queue stays trustworthy
    // without waiting for the 15-min cron. The escalation BAND moved to the /workspace
    // "Needs you" inbox (EP-ATTENTION-SURFACE: attention ≠ backlog); the hygiene stays
    // here too since /ops still reconciles work. Non-fatal; zero-write once converged.
    runEscalationHygiene().catch(ignoreReadFailure),
  ]);

  // Do not build the hidden List read model for Grid/Board requests. Those
  // views fetch their bounded adapter dataset below; the header needs counts,
  // not thousands of relation-rich records.
  const [listData, counts, session] = await Promise.all([
    view
      ? Promise.resolve(null)
      : Promise.all([
          getBacklogItems().catch(emptyReadResult),
          getDigitalProductsForSelect().catch(emptyReadResult),
          getTaxonomyNodesFlat().catch(emptyReadResult),
          getEpics().catch(emptyReadResult),
          getPortfoliosForSelect().catch(emptyReadResult),
        ]),
    view
      ? Promise.all([
          prisma.epic.count().catch(zeroReadResult),
          prisma.backlogItem.count().catch(zeroReadResult),
        ])
      : Promise.resolve(null),
    auth().catch(nullReadResult),
  ]);
  const items = listData?.[0] ?? [];
  const digitalProducts = listData?.[1] ?? [];
  const taxonomyNodes = listData?.[2] ?? [];
  const epics = listData?.[3] ?? [];
  const portfolios = listData?.[4] ?? [];
  const epicCount = counts?.[0] ?? epics.length;
  const itemCount = counts?.[1] ?? items.length;
  // Current operator — resolves the "mine" scope in the Needs-you-next band
  // (BI-01CC2356). Optional: the band degrades to an urgency-only split when absent.
  const currentUserId = session?.user?.id ?? undefined;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Operations</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {epicCount} epic{epicCount !== 1 ? "s" : ""} · {itemCount} item{itemCount !== 1 ? "s" : ""}
        </p>
      </div>

      <OpsTabNav />

      <PlatformGridSection
        entityType="backlog_item"
        view={view}
        dataScope={dataScope}
      />

      {!view ? (
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
      ) : null}
    </div>
  );
}
