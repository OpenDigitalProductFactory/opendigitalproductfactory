// The two pieces of the AC-PROBE runner that live behind the tool catalog
// (BI-129EFFD1): the tool lookup and the server's governance hooks. The
// runner is reached from a tool pack, so importing the catalog or the hook
// registration from it would close an import cycle through the registry.
// The boot registration (registerServerToolGovernanceHooks) installs them
// here instead, as it installs the decision-routing gate's catalog resolver.
import type { Prisma } from "@dpf/db";

import type { GovernedExecuteArgs, GovernedExecuteResult } from "@/lib/mcp-governed-execute-types";
import type { ToolDefinition } from "@/lib/mcp-tool-types";

export type ApprovalProbeRuntime = {
  findTool(name: string): ToolDefinition | undefined;
  /** Run the server's pre-tool governance hooks over `event`, every hook bound to `db`. */
  runGovernanceHooks(
    event: GovernedExecuteArgs,
    db: Prisma.TransactionClient,
    options: { notifyCircuit: () => Promise<void> },
  ): Promise<GovernedExecuteResult | null>;
};

// Process-wide via globalThis (BI-7DE3F806): instrumentation installs this and
// the MCP route requires it, and Next can load this module from different
// bundle chunks for the two, so a module-level variable installed at boot was
// invisible to the tool. Same reason as build-liveness.ts (BI-4EB33E54).
const RUNTIME_KEY = "__dpfApprovalProbeRuntime";

function scope(): Record<string, ApprovalProbeRuntime | null | undefined> {
  return globalThis as unknown as Record<string, ApprovalProbeRuntime | null | undefined>;
}

export function installApprovalProbeRuntime(next: ApprovalProbeRuntime | null): void {
  scope()[RUNTIME_KEY] = next;
}

export function requireApprovalProbeRuntime(): ApprovalProbeRuntime {
  const runtime = scope()[RUNTIME_KEY];
  if (!runtime) throw new Error("The approval convergence probe is not available: server governance hooks are not registered.");
  return runtime;
}
