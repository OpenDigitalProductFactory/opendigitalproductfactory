"use server";

// Collaborative-estimation write action (EP-DELIVERY-FLOW BI-AA1763CD). The
// Delivery Flow board (a client component) calls this to record an attributed
// effort estimate — an AI coworker's first-pass proposal, or a human's
// confirm/overrule/reconcile — through the governed `record_effort_estimate`
// MCP door. The tool resolves provenance, mirrors the effective estimate into
// jobSize, and recomputes demandScore, so the agreed estimate feeds the score.
//
// Domain failures are RETURNED as values (never thrown): a thrown error is
// stripped to a generic message in a prod "use server" bundle, so the card
// could not tell the user why. Only the auth guard throws (framework contract).

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/actions/shared/guards";
import { executeTool } from "@/lib/mcp-tools";
import { firstPassJobSize } from "@/lib/demand/estimate-provenance";

// Not exported (a "use server" module may only export async functions); the
// client infers this via Awaited<ReturnType<typeof recordEstimate>>.
type EstimateActionResult =
  | { ok: true; message: string; data: Record<string, unknown> }
  | { ok: false; error: string };

export type EstimateBy = "ai" | "human";

/**
 * Record an attributed effort estimate for a demand item.
 *
 * - `by:"ai"` with no `jobSize` derives the AI first-pass from the item's
 *   t-shirt effortSize (server-authoritative), so "propose on arrival" needs no
 *   client-side heuristic.
 * - `by:"human"` sets/overrules with an explicit `jobSize`, or `agree:true`
 *   confirms/adopts the current AI estimate (reconcile).
 */
export async function recordEstimate(input: {
  itemId: string;
  by: EstimateBy;
  jobSize?: number;
  agentId?: string;
  agree?: boolean;
}): Promise<EstimateActionResult> {
  const { userId } = await requireCapability("manage_backlog");

  const itemId = typeof input.itemId === "string" ? input.itemId.trim() : "";
  if (!itemId) return { ok: false, error: "No item to estimate." };
  if (input.by !== "ai" && input.by !== "human") {
    return { ok: false, error: "Estimate source must be AI or employee." };
  }

  const args: Record<string, unknown> = { itemId, by: input.by };
  const explicitJobSize =
    typeof input.jobSize === "number" && Number.isFinite(input.jobSize) && input.jobSize > 0
      ? input.jobSize
      : null;
  if (explicitJobSize !== null) args["jobSize"] = explicitJobSize;
  if (input.agree === true) args["agree"] = true;

  if (input.by === "ai") {
    // Derive the first-pass from the intake effort signal when no number given.
    if (explicitJobSize === null) {
      const item = await prisma.backlogItem.findUnique({
        where: { itemId },
        select: { effortSize: true },
      });
      if (!item) return { ok: false, error: `Item ${itemId} not found.` };
      const derived = firstPassJobSize(item.effortSize);
      if (derived === null) {
        return { ok: false, error: "No effort size to base a first-pass AI estimate on — size the item first." };
      }
      args["jobSize"] = derived;
    }
    args["agentId"] = input.agentId ?? "first-pass";
  }

  const res = await executeTool("record_effort_estimate", args, userId, { routeContext: "/ops/demand" });
  if (!res.success) {
    return { ok: false, error: res.message ?? "Could not record the estimate." };
  }
  revalidatePath("/ops/demand");
  return {
    ok: true,
    message: res.message ?? "Estimate recorded.",
    data: (res.data as Record<string, unknown>) ?? {},
  };
}
