"use server";

import { revalidatePath } from "next/cache";

import { requireCapability } from "@/lib/actions/shared/guards";
import { executeTool } from "@/lib/mcp-tools";

async function runDemandTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const { userId } = await requireCapability("manage_backlog");
  const result = await executeTool(name, args, userId, {
    routeContext: "/ops/demand",
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
