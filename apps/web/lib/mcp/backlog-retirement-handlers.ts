import {
  CLEAR_DEFERRAL_PROJECTION,
  normalizeDeferralInput,
} from "@/lib/backlog/deferral-contract";
import { resolveDuplicateBacklogRowId } from "@/lib/backlog/duplicate-resolution";
import type { ToolResult } from "@/lib/mcp-tools";

export async function triageBacklogItemTool(params: Record<string, unknown>): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const itemId = String(params["itemId"] ?? "");
  const outcome = String(params["outcome"] ?? "");
  const rationale = String(params["rationale"] ?? "").trim();
  const item = await prisma.backlogItem.findUnique({ where: { itemId } });
  if (!item) return { success: false, error: "Item not found", message: `Item ${itemId} not found` };
  if (item.status !== "triaging") return { success: false, error: "Item is not in triaging status", message: `Item ${itemId} is not in triaging status` };
  if (!rationale) return { success: false, error: "Rationale is required", message: "Rationale is required" };
  if (outcome === "build" && typeof params["effortSize"] !== "string") {
    return { success: false, error: "effortSize is required for build outcomes", message: "effortSize is required for build outcomes" };
  }
  if (outcome === "duplicate" && typeof params["duplicateOfId"] !== "string") {
    return { success: false, error: "duplicateOfId is required for duplicate outcomes", message: "duplicateOfId is required for duplicate outcomes" };
  }
  if ((outcome === "defer" || outcome === "discard") && typeof params["reason"] !== "string") {
    return { success: false, error: "reason is required for defer/discard outcomes", message: "reason is required for defer/discard outcomes" };
  }
  const deferral = outcome === "defer" ? normalizeDeferralInput(params["deferral"]) : null;
  if (deferral && !deferral.ok) return { success: false, error: deferral.error, message: deferral.message };

  const duplicateRef = typeof params["duplicateOfId"] === "string" ? params["duplicateOfId"] : "";
  const duplicateRowId = outcome === "duplicate" ? await resolveDuplicateBacklogRowId(prisma, duplicateRef) : null;
  if (outcome === "duplicate" && !duplicateRowId) {
    return { success: false, error: "duplicate_not_found", message: `Canonical item ${duplicateRef} not found` };
  }

  let deferralOwnerId: string | null = null;
  if (deferral?.ok) {
    const owner = await prisma.principal.findFirst({
      where: { OR: [{ id: deferral.value.deferOwnerPrincipalId }, { principalId: deferral.value.deferOwnerPrincipalId }] },
      select: { id: true },
    });
    if (!owner) return { success: false, error: "defer_owner_not_found", message: `Deferral owner ${deferral.value.deferOwnerPrincipalId} was not found` };
    deferralOwnerId = owner.id;
  }

  const nextStatus = outcome === "build" || outcome === "runbook" || outcome === "coworker-task"
    ? "open"
    : outcome === "defer" ? "deferred" : "retired";
  const transitionedAt = new Date();
  await prisma.backlogItem.update({
    where: { itemId },
    data: {
      status: nextStatus,
      triageOutcome: outcome,
      effortSize: typeof params["effortSize"] === "string" ? params["effortSize"] : null,
      duplicateOfId: duplicateRowId,
      resolution: rationale,
      abandonReason: typeof params["reason"] === "string" ? params["reason"] : null,
      completedAt: nextStatus === "retired" ? transitionedAt : null,
      ...(deferral?.ok
        ? {
            deferReason: deferral.value.deferReason,
            deferTrigger: deferral.value.deferTrigger,
            deferReviewAt: deferral.value.deferReviewAt,
            deferOwnerPrincipalId: deferralOwnerId,
            deferredAt: transitionedAt,
          }
        : CLEAR_DEFERRAL_PROJECTION),
    },
  });
  return { success: true, entityId: itemId, message: `Triaged ${itemId} as ${outcome}` };
}

export async function retireBacklogItemTool(
  params: Record<string, unknown>,
  userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const itemId = String(params["itemId"] ?? "");
  const outcome = String(params["outcome"] ?? "");
  const rationale = String(params["rationale"] ?? "").trim();
  const reason = typeof params["reason"] === "string" ? params["reason"].trim() : "";
  const duplicateOfId = typeof params["duplicateOfId"] === "string" ? params["duplicateOfId"].trim() : "";
  const validOutcomes = new Set(["duplicate", "defer", "discard"]);
  if (!itemId) return { success: false, error: "missing_itemId", message: "itemId is required" };
  if (!validOutcomes.has(outcome)) return { success: false, error: "invalid_outcome", message: "outcome must be duplicate, defer, or discard" };
  if (!rationale) return { success: false, error: "missing_rationale", message: "rationale is required" };
  if (outcome === "duplicate" && !duplicateOfId) {
    return { success: false, error: "missing_duplicateOfId", message: "duplicateOfId is required for duplicate retirement" };
  }
  const deferral = outcome === "defer" ? normalizeDeferralInput(params["deferral"]) : null;
  if (deferral && !deferral.ok) return { success: false, error: deferral.error, message: deferral.message };

  return prisma.$transaction(async (tx) => {
    const item = await tx.backlogItem.findUnique({ where: { itemId } });
    if (!item) return { success: false, error: "not_found", message: `Item ${itemId} not found` } satisfies ToolResult;
    if ("activeBuildId" in item && item.activeBuildId) {
      return { success: false, error: "active_build_exists", message: `Item ${itemId} is attached to an active build and cannot be retired` } satisfies ToolResult;
    }

    const canonicalRowId = outcome === "duplicate" ? await resolveDuplicateBacklogRowId(tx, duplicateOfId) : null;
    if (outcome === "duplicate" && !canonicalRowId) {
      return { success: false, error: "duplicate_not_found", message: `Canonical item ${duplicateOfId} not found` } satisfies ToolResult;
    }

    let deferralOwnerId: string | null = null;
    if (deferral?.ok) {
      const owner = await tx.principal.findFirst({
        where: { OR: [{ id: deferral.value.deferOwnerPrincipalId }, { principalId: deferral.value.deferOwnerPrincipalId }] },
        select: { id: true },
      });
      if (!owner) return { success: false, error: "defer_owner_not_found", message: `Deferral owner ${deferral.value.deferOwnerPrincipalId} was not found` } satisfies ToolResult;
      deferralOwnerId = owner.id;
    }

    const nextStatus = outcome === "defer" ? "deferred" : "retired";
    const transitionedAt = new Date();
    const updated = await tx.backlogItem.update({
      where: { id: item.id },
      data: {
        status: nextStatus,
        triageOutcome: outcome,
        duplicateOfId: canonicalRowId,
        resolution: rationale,
        abandonReason: reason || rationale,
        completedAt: nextStatus === "retired" ? transitionedAt : null,
        ...(deferral?.ok
          ? {
              deferReason: deferral.value.deferReason,
              deferTrigger: deferral.value.deferTrigger,
              deferReviewAt: deferral.value.deferReviewAt,
              deferOwnerPrincipalId: deferralOwnerId,
              deferredAt: transitionedAt,
            }
          : CLEAR_DEFERRAL_PROJECTION),
      },
    });
    await tx.backlogItemActivity.create({
      data: {
        backlogItemId: item.id,
        kind: "status_change",
        recordedById: userId,
        recordedByAgentId: context?.agentId ?? null,
        summary: `Retired ${itemId} as ${outcome}`,
        payload: {
          from: item.status,
          to: nextStatus,
          outcome,
          rationale,
          reason: reason || null,
          duplicateOfId: outcome === "duplicate" ? duplicateOfId : null,
          ...(deferral?.ok
            ? {
                deferral: {
                  reason: deferral.value.deferReason,
                  trigger: deferral.value.deferTrigger,
                  reviewAt: deferral.value.deferReviewAt.toISOString(),
                  ownerPrincipalId: deferralOwnerId,
                },
              }
            : {}),
        },
      },
    });

    if (item.epicId && nextStatus === "retired") {
      const remainingOpenItems = await tx.backlogItem.count({
        where: { epicId: item.epicId, status: { notIn: ["done", "retired"] }, id: { not: item.id } },
      });
      if (remainingOpenItems === 0) await tx.epic.update({ where: { id: item.epicId }, data: { status: "done" } });
    }
    return {
      success: true,
      entityId: updated.itemId,
      message: `Retired ${itemId} as ${outcome}`,
      data: { itemId: updated.itemId, status: nextStatus, outcome, duplicateOfId: outcome === "duplicate" ? duplicateOfId : null },
    } satisfies ToolResult;
  });
}
