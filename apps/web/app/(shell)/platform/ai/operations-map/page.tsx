import { OperationsMapLiveShell } from "@/components/platform/OperationsMapLiveShell";
import { loadOperationsMapData } from "@/lib/ai-operations-map/load-map-data";
import type { RoutingArchitectureMode } from "@/lib/ai-operations-map/routing-comparison-view-model";
import { readRoutingScope, routingWindow } from "@/lib/ai-operations-map/routing-management-scope";

export const dynamic = "force-dynamic";

export default async function OperationsMapPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const query = (await searchParams) ?? {};
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const first = firstQueryValue(value);
    if (first !== null) params.set(key, first);
  }
  const data = await loadOperationsMapData({ window: routingWindow(readRoutingScope(params), Date.now()) });
  const initialArchitectureMode = parseArchitectureMode(query.mode);
  const initialFocusStageId = firstQueryValue(query.focus);

  return (
    <OperationsMapLiveShell
      initialData={data}
      initialArchitectureMode={initialArchitectureMode}
      initialFocusStageId={initialFocusStageId}
      initialTechnicalOpen={params.has("mode") || params.has("focus")}
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
