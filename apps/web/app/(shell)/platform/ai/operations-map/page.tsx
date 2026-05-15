import { AiOperationsMap } from "@/components/platform/AiOperationsMap";
import { loadOperationsMapData } from "@/lib/ai-operations-map/load-map-data";

export const dynamic = "force-dynamic";

export default async function OperationsMapPage() {
  const data = await loadOperationsMapData();

  return (
    <AiOperationsMap
      template={data.template}
      agents={data.agents}
      projections={data.projections}
      routingTopology={data.routingTopology}
      recentWindowLabel={data.recentWindowLabel}
    />
  );
}
