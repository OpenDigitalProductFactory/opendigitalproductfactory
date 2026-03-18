import type { ToolDefinition } from "@/lib/mcp-tools";

/**
 * A page-specific action that extends ToolDefinition with spec traceability.
 * PageAction instances are directly usable as ToolDefinition (structural subtype).
 */
export type PageAction = ToolDefinition & {
  /** Links to the originating spec (e.g., EP-EMP-001) */
  specRef: string;
};

export type PageActionManifest = {
  /** Route prefix this manifest applies to (e.g., "/employee") */
  route: string;
  /** Available actions on this page */
  actions: PageAction[];
};
