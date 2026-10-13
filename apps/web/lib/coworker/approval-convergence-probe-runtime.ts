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

let runtime: ApprovalProbeRuntime | null = null;

export function installApprovalProbeRuntime(next: ApprovalProbeRuntime | null): void {
  runtime = next;
}

export function requireApprovalProbeRuntime(): ApprovalProbeRuntime {
  if (!runtime) throw new Error("The approval convergence probe is not available: server governance hooks are not registered.");
  return runtime;
}
