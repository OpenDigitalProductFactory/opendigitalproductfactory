// apps/web/app/(shell)/ops/page.tsx
import { getBacklogItems, getDigitalProductsForSelect, getTaxonomyNodesFlat, getEpics, getPortfoliosForSelect } from "@/lib/backlog-data";
import { OpsClient } from "@/components/ops/OpsClient";
import { OpsTabNav } from "@/components/ops/OpsTabNav";

export default async function OpsPage() {
  const [items, digitalProducts, taxonomyNodes, epics, portfolios] = await Promise.all([
    getBacklogItems(),
    getDigitalProductsForSelect(),
    getTaxonomyNodesFlat(),
    getEpics(),
    getPortfoliosForSelect(),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Operations</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {epics.length} epic{epics.length !== 1 ? "s" : ""} · {items.length} item{items.length !== 1 ? "s" : ""}
        </p>
      </div>

      <OpsTabNav />

      <OpsClient
        items={items}
        digitalProducts={digitalProducts}
        taxonomyNodes={taxonomyNodes}
        epics={epics}
        portfolios={portfolios}
      />
    </div>
  );
}
