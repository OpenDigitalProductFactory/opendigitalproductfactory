import type { ToolDefinition } from "@/lib/mcp-tools";

export type DynamicToolSurfaceResult = {
  active: ToolDefinition[];
  displaced: ToolDefinition[];
  unattached: ToolDefinition[];
};

/** Baseline reproduction: deferred tools are appended without reapplying the ceiling. */
export function recompileDynamicToolSurface(input: {
  active: readonly ToolDefinition[];
  requested: readonly ToolDefinition[];
  ceiling: number;
}): DynamicToolSurfaceResult {
  return { active: [...input.active, ...input.requested], displaced: [], unattached: [] };
}
