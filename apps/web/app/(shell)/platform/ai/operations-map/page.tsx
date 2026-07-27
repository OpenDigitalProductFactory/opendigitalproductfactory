import { OperationsMapLiveShell } from "@/components/platform/OperationsMapLiveShell";
import { loadOperationsMapData } from "@/lib/ai-operations-map/load-map-data";
import type { RoutingArchitectureMode } from "@/lib/ai-operations-map/routing-comparison-view-model";

export const dynamic = "force-dynamic";

export default async function OperationsMapPage({
  searchParams,
}: {
  searchParams?: Promise<{ mode?: string | string[]; focus?: string | string[] }>;
} = {}) {
  const query = (await searchParams) ?? {};
  const data = await loadOperationsMapData();
  const initialArchitectureMode = parseArchitectureMode(query.mode);
  const initialFocusStageId = firstQueryValue(query.focus);

  return (
    <OperationsMapLiveShell
      initialData={data}
      initialArchitectureMode={initialArchitectureMode}
      initialFocusStageId={initialFocusStageId}
    />
  );
}

function parseArchitectureMode(value: string | string[] | undefined): RoutingArchitectureMode {
  const mode = firstQueryValue(value);
  return mode === "designed" || mode === "observed" || mode === "compare"
    ? mode
    : "compare";
}

function firstQueryValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
