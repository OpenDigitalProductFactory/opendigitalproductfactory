"use server";

import { revalidatePath } from "next/cache";

import { requireCapabilityContext } from "@/lib/actions/shared/guards";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";

// The /ops/demand board's actions run their tools through the reference
// monitor as the signed-in human (GPP PR-H, BI-69415B68): the same capability
// decision requireCapability makes, now with the monitor's audit row and, for
// the irreversible supersede, its receipt. No agent acts here, so no coworker
// authority gate runs; none of these tools needs alignment or a precondition.
async function runDemandTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const { userId, userContext } = await requireCapabilityContext("manage_backlog");
  const result = await governedExecuteTool({
    toolName: name,
    rawParams: args,
    userId,
    userContext,
    context: { routeContext: "/ops/demand" },
    source: "rest",
  });
  if (!result.success) {
    return {
      ok: false,
      error: result.message ?? "The demand update could not be completed.",
    };
  }
  revalidatePath("/ops/demand");
  revalidatePath("/portfolio");
  return { ok: true, message: result.message ?? "Demand updated." };
}

export async function transitionDemand(input: {
  itemId: string;
  to: "raw" | "screened" | "shaped";
  rationale?: string;
}) {
  return runDemandTool("transition_demand_item", input);
}

export async function linkEvidenceToDemand(input: {
  itemId: string;
  sourceKind: string;
  sourceRef: string;
  title: string;
  summary?: string;
  confidence?: number;
  reviewedAt?: string;
}) {
  return runDemandTool("link_demand_evidence", input);
}

export async function supersedeEvidenceFromDemand(input: {
  evidenceLinkId: string;
  rationale: string;
}) {
  return runDemandTool("supersede_demand_evidence", input);
}

export async function requestDemandFunding(input: {
  itemId: string;
  rationale?: string;
}) {
  return runDemandTool("approve_demand_for_funding", input);
}
