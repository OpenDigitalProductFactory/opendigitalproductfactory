// Sidecar transport binding (EP-BROWSER-DRIVE).
//
// The M2 adapter takes an injected SidecarTransport so it is testable. At runtime
// that transport is bound here to the namespaced `mcp-browser-use` execution path
// (the browser-use sidecar registered as an McpServer). The adapter calls bare
// tool names (browse_open, browse_act, …); this binding routes them through
// executeMcpServerTool, which performs the HTTP JSON-RPC call to the sidecar.

import { executeMcpServerTool } from "@/lib/tak/mcp-server-tools";
import type { SidecarTransport } from "./means-m2-plugin";

/** McpServer.serverId of the bundled browser-use sidecar. */
export const BROWSER_USE_SERVER_SLUG = "mcp-browser-use";

/**
 * A SidecarTransport bound to the real browser-use sidecar. Strips undefined
 * args (the sidecar's optional params), calls executeMcpServerTool, and returns
 * the tool's structured data — surfacing transport/tool failures as an `error`
 * field so the adapter records a failed ToolExecution rather than throwing.
 */
export function makeSidecarTransport(): SidecarTransport {
  return async (toolName, args) => {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      if (v !== undefined) cleaned[k] = v;
    }
    const res = await executeMcpServerTool(BROWSER_USE_SERVER_SLUG, toolName, cleaned);
    if (!res.success) {
      return { error: res.error ?? res.message ?? "sidecar tool failed" };
    }
    return res.data ?? {};
  };
}
