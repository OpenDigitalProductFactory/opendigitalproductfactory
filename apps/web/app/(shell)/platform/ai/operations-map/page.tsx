import { OperationsMapLiveShell } from "@/components/platform/OperationsMapLiveShell";
import { loadOperationsMapData } from "@/lib/ai-operations-map/load-map-data";

export const dynamic = "force-dynamic";

export default async function OperationsMapPage() {
  const data = await loadOperationsMapData();

  return <OperationsMapLiveShell initialData={data} />;
}
