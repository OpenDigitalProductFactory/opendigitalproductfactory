// Which MCP tools stay callable while the portal drains for an upgrade.
// Reads always do; a side-effecting tool only when it keeps work that is
// already in flight alive or cleans up after it, and starts nothing new.
// Moved out of app/api/mcp/v1/route.ts (module-size ceiling).
import type { ToolDefinition } from "@/lib/mcp-tool-types";

export const QUIESCENCE_SAFE_SIDE_EFFECT_TOOLS = new Set([
  // Releasing a lease is cleanup, and is what prevents quiescence-blocked
  // local-CI evidence writes from leaking scarce nonprod environments.
  "release_nonprod_environment_lease",
  // Renewing keeps a gate that is already running alive through a drain, so
  // its verdict is not lost to the lease lapsing mid-build (2026-09-24).
  "renew_nonprod_environment_lease",
  // BI-F9EE05E5 slice C: a drain can now wait up to an hour. Heartbeats keep
  // work that is already in flight alive (the same reason as lease renewal)
  // and start nothing new, so an external agent is not reaped for being
  // refused. Evidence writes stay refused and are retried after the swap.
  "heartbeat_workroom",
  "heartbeat_runtime_target",
]);

export function isToolAllowedDuringQuiescence(toolName: string, tool: ToolDefinition | undefined): boolean {
  if (toolName === "get_quiescence_status") return true;
  if (tool?.sideEffect === false) return true;
  return QUIESCENCE_SAFE_SIDE_EFFECT_TOOLS.has(toolName);
}
