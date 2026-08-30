// Backlog & epic tool pack — EP-8DC217EB BET-4.
//
// Drains the backlog/epic domain out of the mcp-tools.ts executeTool switch:
// the tools the Scrum Master / ops co-workers use to create, read, list, query,
// triage, size, retire, update, and status-transition backlog items, link them
// to epics, create/update/list epics, recommend the next item to pick up, and
// queue an on-demand governed Build Studio backlog sweep. Each handler lazy-
// imports its collaborators and reproduces the former switch case verbatim, so
// behaviour is identical when a tool is invoked over MCP.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.
//
// `updateBuildHappyPathState` (backing create_backlog_item's `/build`
// happy-path update) is imported from the shared build-tool-helpers module
// (EP-8DC217EB BET-4), which owns the one canonical copy of the build-
// resolution helpers rather than replicating them per pack.

import { getErrorMessage } from "@/lib/shared/get-error-message";
import { handleUpdateBacklogItem } from "./backlog-update-item-handler";
import { updateBuildHappyPathState } from "@/lib/mcp/build-tool-helpers";
import { optionalStringParam, stringArrayParam, validScopeKind } from "./backlog-scope-metadata";
import {
  getBacklogItem,
  getNextRecommendedWork,
  listBacklogItems,
  listEpics,
  queryBacklog,
} from "./backlog-pack-read-tools";
import type { BacklogIngestInput } from "@/lib/operate/backlog-ingest";
import type { ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";
import { tryAcquireBacklogClaimAtomic } from "@/lib/backlog/claim-on-start";
import { normalizeCompletionEvidenceManifest } from "@/lib/backlog/completion-evidence-policy";
import { backlogPackDefinitions as definitions } from "./backlog-pack-definitions";
import {
  CLEAR_DEFERRAL_PROJECTION,
  normalizeDeferralInput,
} from "@/lib/backlog/deferral-contract";
import { retireBacklogItemTool, triageBacklogItemTool } from "@/lib/mcp/backlog-retirement-handlers";
import { completeBacklogItemTransitionTool } from "@/lib/backlog/mcp-terminal-status";
// ── Handlers (case bodies moved verbatim) ───────────────────────────────────

async function createBacklogItem(
  params: Record<string, unknown>,
  userId: string,
  context?: { routeContext?: string; agentId?: string },
): Promise<ToolResult> {
  // Converged onto the shared backlog-ingest front door (EP-INTAKE-UNIFY):
  // one validation + create + semantic-index + epic-resolve path, shared
  // with every detector/queue. This MCP boundary preserves its structured
  // {success:false} contract by catching the front door's validation throws.
  let productScope:
    | {
        organizationId: string;
        productLineId: string | null;
        businessProductId: string | null;
        digitalProductId: string | null;
      }
    | undefined;
  const organizationRef = optionalStringParam(params, "organizationId");
  const productLineRef = optionalStringParam(params, "productLineId");
  const businessProductRef = optionalStringParam(params, "businessProductId");
  const digitalProductRef = optionalStringParam(params, "digitalProductId");
  if (
    organizationRef ||
    productLineRef ||
    businessProductRef ||
    digitalProductRef
  ) {
    if (!organizationRef) {
      return {
        success: false,
        error: "organization_required",
        message:
          "organizationId is required when assigning product-management scope.",
      };
    }
    try {
      const { prisma } = await import("@dpf/db");
      const { resolveProductManagementScopeRefs } = await import(
        "@/lib/product-management/product-management-scope"
      );
      productScope = await resolveProductManagementScopeRefs(
        {
          organizationRef,
          productLineRef,
          businessProductRef,
          digitalProductRef,
        },
        prisma,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid product-management scope.";
      return { success: false, error: "invalid_product_scope", message };
    }
  }

  const ingestInput = {
    title: String(params["title"] ?? "Untitled"),
    // Historical default for the MCP tool is product (ownership axis).
    type: params["type"] === "portfolio" ? "portfolio" : "product",
    workType: typeof params["workType"] === "string" ? params["workType"] : "",
    // The MCP tool is human-driven by contract; default origin = user-request.
    source: typeof params["source"] === "string" ? params["source"] : "user-request",
    status: typeof params["status"] === "string" ? params["status"] : "triaging",
    triageOutcome: typeof params["triageOutcome"] === "string" ? params["triageOutcome"] : undefined,
    proposedOutcome: typeof params["proposedOutcome"] === "string" ? params["proposedOutcome"] : undefined,
    effortSize: typeof params["effortSize"] === "string" ? params["effortSize"] : undefined,
    priority: typeof params["priority"] === "number" ? params["priority"] : undefined,
    body: typeof params["body"] === "string" ? params["body"] : undefined,
    scopeKind: validScopeKind(params["scopeKind"]),
    archetypeCategories: stringArrayParam(params, "archetypeCategories"),
    archetypeIds: stringArrayParam(params, "archetypeIds"),
    scopeRationale: optionalStringParam(params, "scopeRationale"),
    lifecycleTags: stringArrayParam(params, "lifecycleTags"),
    organizationId: productScope?.organizationId,
    productLineId: productScope?.productLineId,
    businessProductId: productScope?.businessProductId,
    digitalProductId: productScope?.digitalProductId,
    itemId:
      typeof params["itemId"] === "string" && params["itemId"].trim()
        ? params["itemId"].trim()
        : undefined,
    epicId:
      typeof params["epicId"] === "string" && params["epicId"].trim()
        ? params["epicId"].trim()
        : undefined,
    submittedById: userId,
    agentId: context?.agentId ?? null,
  } as unknown as BacklogIngestInput;

  try {
    const { ingestBacklogItem } = await import("@/lib/operate/backlog-ingest");
    const result = await ingestBacklogItem(ingestInput);
    if (context?.routeContext === "/build") {
      await updateBuildHappyPathState(userId, {
        intake: {
          backlogItemId: result.itemId,
          epicId: typeof params["epicId"] === "string" ? params["epicId"] : null,
        },
      });
    }
    const { withScanAdvisory } = await import("@/lib/operate/implementation-scan");
    const created = `Created backlog item ${result.itemId}`;
    const message = withScanAdvisory(created, result.implementationCandidates ?? []);
    return { success: true, entityId: result.itemId, message };
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.message.replace(/^\[backlog-ingest\]\s*/, "")
        : "Failed to create backlog item";
    return { success: false, error: msg, message: msg };
  }
}

async function triageBacklogItem(params: Record<string, unknown>): Promise<ToolResult> {
  return triageBacklogItemTool(params);
}

async function retireBacklogItem(
  params: Record<string, unknown>,
  userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  return retireBacklogItemTool(params, userId, context);
}

async function sizeBacklogItem(params: Record<string, unknown>): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const itemId = String(params["itemId"] ?? "");
  const size = String(params["size"] ?? "");
  const item = await prisma.backlogItem.findUnique({ where: { itemId } });
  if (!item) {
    return { success: false, error: "Item not found", message: `Item ${itemId} not found` };
  }
  await prisma.backlogItem.update({
    where: { itemId },
    data: { effortSize: size },
  });
  return {
    success: true,
    entityId: itemId,
    message: `Sized ${itemId} as ${size}`,
  };
}

async function processBacklogForBuildStudio(
  params: Record<string, unknown>,
  userId: string,
  context?: { routeContext?: string; threadId?: string; agentId?: string },
): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const governedConfig = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: {
      governedBacklogEnabled: true,
      backlogTeeUpDailyCap: true,
    },
  });

  if (governedConfig?.governedBacklogEnabled !== true) {
    return {
      success: false,
      error: "Governed backlog mode is disabled",
      message: "Governed backlog mode must be enabled before backlog processing can be queued.",
    };
  }

  const requestedLimitRaw = Number(params["limit"]);
  const configuredCap = governedConfig.backlogTeeUpDailyCap ?? 3;
  const limit = Number.isFinite(requestedLimitRaw)
    ? Math.min(Math.max(0, Math.floor(requestedLimitRaw)), configuredCap)
    : configuredCap;

  const { inngest } = await import("@/lib/queue/inngest-client");
  await inngest.send({
    name: "build/backlog-tee-up.requested",
    data: {
      userId,
      limit,
      routeContext: context?.routeContext ?? null,
      threadId: context?.threadId ?? null,
      requestedByAgentId: context?.agentId ?? null,
    },
  });

  return {
    success: true,
    message: "Queued an on-demand backlog sweep for Build Studio draft tee-up.",
    data: {
      status: "queued",
      limit,
    },
  };
}

async function createEpic(
  params: Record<string, unknown>,
  userId: string,
  context?: Parameters<ToolPackHandler>[2],
): Promise<ToolResult> {
  const { createEpicTool } = await import("@/lib/backlog/mcp-epic-tools");
  return createEpicTool(params, userId, context);
}

async function updateEpic(
  params: Record<string, unknown>,
  userId: string,
  context?: Parameters<ToolPackHandler>[2],
): Promise<ToolResult> {
  const { updateEpicTool } = await import("@/lib/backlog/mcp-epic-tools");
  return updateEpicTool(params, userId, context);
}

async function updateBacklogItemStatus(
  params: Record<string, unknown>,
  userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const { isLegalTransition, isBacklogStatus } = await import("@/lib/backlog/transitions");
  const itemIdRaw = String(params["itemId"] ?? "").trim();
  const target = String(params["status"] ?? "");
  if (!itemIdRaw)
    return { success: false, error: "missing_itemId", message: "itemId is required" };
  if (!isBacklogStatus(target))
    return {
      success: false,
      error: "invalid_status",
      message: `status must be one of triaging|open|in-progress|done|deferred|retired, got ${target}`,
    };
  const deferral = target === "deferred"
    ? normalizeDeferralInput(params["deferral"])
    : null;
  if (deferral && !deferral.ok) return { success: false, error: deferral.error, message: deferral.message };
  const reason = typeof params["reason"] === "string" ? params["reason"] : null;
  const resolution = typeof params["resolution"] === "string" ? params["resolution"] : null;
  const completionEvidence =
    target === "done"
      ? normalizeCompletionEvidenceManifest(params["completionEvidence"])
      : null;
  if (target === "done" && !resolution)
    return {
      success: false,
      error: "missing_resolution",
      message: "resolution is required when status=done",
    };
  // Retriage requires a reason so the audit trail explains why a triaged decision was reopened.
  // (Reason is checked against the *current* status below, after the item is loaded.)
  const item = await prisma.backlogItem.findUnique({
    where: { itemId: itemIdRaw },
    select: {
      id: true,
      status: true,
      epicId: true,
      triageOutcome: true,
      effortSize: true,
      activeBuildId: true,
      claimStatus: true,
      claimedById: true,
      claimedByAgentId: true,
      claimedAt: true,
      deferredAt: true,
      organizationId: true,
    },
  });
  if (!item)
    return { success: false, error: "not_found", message: `Item ${itemIdRaw} not found` };
  if (!isBacklogStatus(item.status))
    return {
      success: false,
      error: "corrupt_current_status",
      message: `Item ${itemIdRaw} has non-canonical status ${item.status}`,
    };
  if (!isLegalTransition(item.status, target))
    return {
      success: false,
      error: "illegal_transition",
      message: `cannot move ${itemIdRaw} from ${item.status} to ${target}`,
    };

  // Claim-on-start (BI-B62B9F1E): the DB UPDATE is the gate (row-level
  // serialize), not a pre-transaction freshness read. Concurrent sessions
  // race on the same row; the loser's WHERE fails (count=0) → claim_conflict.
  // Stale claims reclaim inline; force=true takes over. Release on leave.
  const forceClaim = params["force"] === true;
  if (item.status === target && target !== "deferred") {
    return {
      success: true,
      entityId: itemIdRaw,
      message: `${itemIdRaw} already at status=${target} (no-op)`,
    };
  }
  if (target === "retired" && !reason) {
    return {
      success: false,
      error: "missing_reason",
      message: "reason is required when status=retired",
    };
  }
  if (deferral?.ok) {
    const owner = await prisma.principal.findFirst({
      where: {
        OR: [
          { id: deferral.value.deferOwnerPrincipalId },
          { principalId: deferral.value.deferOwnerPrincipalId },
        ],
      },
      select: { id: true },
    });
    if (!owner) {
      return {
        success: false,
        error: "defer_owner_not_found",
        message: `Deferral owner ${deferral.value.deferOwnerPrincipalId} was not found`,
      };
    }
    deferral.value.deferOwnerPrincipalId = owner.id;
  }
  // Retriage path (BI-7D4AF644): require a reason and clear the prior triage
  // decision so triage_backlog_item starts clean on the next pass.
  const isRetriage = target === "triaging" && item.status !== "triaging";
  if (isRetriage && !reason) {
    return {
      success: false,
      error: "missing_reason",
      message: "reason is required when moving an item back to triaging — explain why the prior triage needs to be revisited",
    };
  }

  if (target === "done") {
    return completeBacklogItemTransitionTool({
      item,
      itemId: itemIdRaw,
      resolution: resolution!,
      completionEvidence: params["completionEvidence"],
      userId,
      agentId: context?.agentId,
    });
  }

  let forcedClaimAcquired = false;
  if (target === "in-progress") {
    const claimResult = await tryAcquireBacklogClaimAtomic({
      db: prisma,
      itemRowId: item.id,
      userId,
      agentId: context?.agentId ?? null,
      force: forceClaim,
    });
    if (!claimResult.ok) {
      return {
        success: false,
        error: "claim_conflict",
        message:
          `${itemIdRaw} is already claimed (active` +
          (claimResult.claimAgeMinutes != null ? `, ${claimResult.claimAgeMinutes}m ago` : "") +
          ") by another session. Coordinate with the holder, pick different work, or pass force=true to take it over.",
        data: {
          claimedById: claimResult.claimedById,
          claimedByAgentId: claimResult.claimedByAgentId,
          claimedAt: claimResult.claimedAt,
        },
      };
    }
    forcedClaimAcquired = claimResult.forced;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const transitionedAt = new Date();
    const next = await tx.backlogItem.update({
      where: { id: item.id },
      data: {
        status: target,
        ...(target === "retired" ? { completedAt: transitionedAt } : {}),
        ...(target !== "retired" && (item.status === "done" || item.status === "retired")
          ? { completedAt: null }
          : {}),
        ...(deferral?.ok
          ? {
              ...deferral.value,
              deferredAt: item.deferredAt ?? transitionedAt,
            }
          : target !== "deferred"
            ? CLEAR_DEFERRAL_PROJECTION
            : {}),
        ...(isRetriage ? { triageOutcome: null, effortSize: null, completedAt: null } : {}),
        // Claim fields written by tryAcquireBacklogClaimAtomic above.
        ...(item.status === "in-progress" && target !== "in-progress"
          ? { claimStatus: "released" }
          : {}),
      },
      select: { itemId: true, status: true, epicId: true, completedAt: true },
    });
    await tx.backlogItemActivity.create({
      data: {
        backlogItemId: item.id,
        kind: item.status === "deferred" && target === "deferred" ? "deferral_review" : "status_change",
        summary: `${item.status} → ${target}` + (reason ? ` — ${reason.slice(0, 160)}` : ""),
        payload: {
          from: item.status,
          to: target,
          reason: reason ?? null,
          resolution: resolution ?? null,
          ...(deferral?.ok
            ? {
                deferral: {
                  reason: deferral.value.deferReason,
                  trigger: deferral.value.deferTrigger,
                  reviewAt: deferral.value.deferReviewAt.toISOString(),
                  ownerPrincipalId: deferral.value.deferOwnerPrincipalId,
                },
              }
            : {}),
          ...(completionEvidence
            ? {
                completionEvidence: {
                  workClass: completionEvidence.workClass,
                  evidenceActivityIds: completionEvidence.evidenceActivityIds,
                  useActiveBuildEvidence: completionEvidence.useActiveBuildEvidence,
                  ux: completionEvidence.ux ?? null,
                  migration: completionEvidence.migration ?? null,
                },
              }
            : {}),
          ...(isRetriage
            ? {
                retriage: true,
                clearedTriageOutcome: item.triageOutcome ?? null,
                clearedEffortSize: item.effortSize ?? null,
              }
            : {}),
          ...(target === "in-progress"
            ? { claimAction: "acquired", forcedClaim: forcedClaimAcquired }
            : item.status === "in-progress"
              ? { claimAction: "released" }
              : {}),
        },
        recordedById: userId,
        recordedByAgentId: context?.agentId ?? null,
      },
    });
    return next;
  });
  // Advisory: flipping a build item to in-progress is not the same as
  // starting the work — surface the promote_to_build_studio path so the
  // coworker can't report a no-op status change as "throughput".
  const { buildPromoteAdvisory } = await import("@/lib/backlog/promote-advisory");
  const promoteAdvisory = buildPromoteAdvisory({
    itemId: updated.itemId,
    targetStatus: updated.status,
    triageOutcome: item.triageOutcome,
    hasActiveBuild: item.activeBuildId != null,
  });
  // EP-3516E23D CWQ activation + BI-AC815F1E lifecycle sync: every backlog status
  // transition is observed by the bridge. It materializes a WorkItem case when
  // work starts (→ in-progress) and, on later transitions, syncs the live case's
  // status (→ done closes it) so the unified WorkCase view tracks the item's whole
  // lifecycle — not just the claim. Idempotent (no duplicate on re-claim) and
  // best-effort — bridging must never fail the transition it observes.
  {
    void (async () => {
      try {
        const { bridgeBacklogItemToWorkItem } = await import(
          "@/lib/queue/bridges/backlog-bridge"
        );
        await bridgeBacklogItemToWorkItem(updated.itemId);
      } catch (err) {
        console.warn(
          `[cwq-bridge] failed to bridge ${updated.itemId} to a work item: ${
            getErrorMessage(err)
          }`,
        );
      }
    })();
  }
  return {
    success: true,
    entityId: updated.itemId,
    message:
      `${updated.itemId}: ${item.status} → ${updated.status}` +
      (promoteAdvisory ? ` — ADVISORY: ${promoteAdvisory}` : ""),
    data: {
      itemId: updated.itemId,
      status: updated.status,
      completedAt: updated.completedAt,
      ...(promoteAdvisory ? { advisory: promoteAdvisory } : {}),
    },
  };
}

async function linkBacklogItemToEpic(
  params: Record<string, unknown>,
  userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const itemIdRaw = String(params["itemId"] ?? "").trim();
  if (!itemIdRaw)
    return { success: false, error: "missing_itemId", message: "itemId is required" };
  const epicRaw = params["epicId"];
  const wantUnlink =
    epicRaw == null ||
    (typeof epicRaw === "string" && (epicRaw.trim() === "" || epicRaw.trim().toLowerCase() === "null"));
  let targetEpicCuid: string | null = null;
  let targetEpicSemantic: string | null = null;
  if (!wantUnlink) {
    const epicRow = await prisma.epic.findFirst({
      where: { OR: [{ epicId: String(epicRaw).trim() }, { id: String(epicRaw).trim() }] },
      select: { id: true, epicId: true, status: true },
    });
    if (!epicRow)
      return { success: false, error: "epic_not_found", message: `No epic matched ${epicRaw}` };
    targetEpicCuid = epicRow.id;
    targetEpicSemantic = epicRow.epicId;
  }
  const item = await prisma.backlogItem.findUnique({
    where: { itemId: itemIdRaw },
    select: {
      id: true,
      epicId: true,
      status: true,
      triageOutcome: true,
      activeBuildId: true,
      epic: { select: { epicId: true } },
    },
  });
  if (!item)
    return { success: false, error: "not_found", message: `Item ${itemIdRaw} not found` };
  const priorEpicSemantic = item.epic?.epicId ?? null;
  if (item.epicId === targetEpicCuid) {
    return {
      success: true,
      entityId: itemIdRaw,
      message: `${itemIdRaw} already linked to ${targetEpicSemantic ?? "no epic"} (no-op)`,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.backlogItem.update({
      where: { id: item.id },
      data: { epicId: targetEpicCuid },
    });
    await tx.backlogItemActivity.create({
      data: {
        backlogItemId: item.id,
        kind: "epic_link",
        summary: `${priorEpicSemantic ?? "(no epic)"} → ${targetEpicSemantic ?? "(no epic)"}`,
        payload: {
          fromEpicId: priorEpicSemantic,
          toEpicId: targetEpicSemantic,
        },
        recordedById: userId,
        recordedByAgentId: context?.agentId ?? null,
      },
    });
    // Reopen epic if we just attached an open/in-progress item to a done epic
    if (targetEpicCuid && (item.status === "open" || item.status === "in-progress")) {
      const target = await tx.epic.findUnique({
        where: { id: targetEpicCuid },
        select: { status: true },
      });
      if (target?.status === "done") {
        await tx.epic.update({
          where: { id: targetEpicCuid },
          data: { status: "open", completedAt: null },
        });
      }
    }
  });
  // Advisory: a coworker asked to "triage + promote" may call this and then
  // report the item as triaged/promoted, when an epic link is purely
  // organizational. Surface the real triage_backlog_item / promote_to_build_studio
  // path when triage/promotion is genuinely unfinished (BI-6C86ADEB).
  const { buildEpicLinkAdvisory } = await import("@/lib/backlog/promote-advisory");
  const epicLinkAdvisory = buildEpicLinkAdvisory({
    itemId: itemIdRaw,
    targetEpicId: targetEpicSemantic,
    triageOutcome: item.triageOutcome,
    hasActiveBuild: item.activeBuildId != null,
  });
  return {
    success: true,
    entityId: itemIdRaw,
    message:
      `Linked ${itemIdRaw} to ${targetEpicSemantic ?? "(no epic)"}` +
      (epicLinkAdvisory ? ` — ADVISORY: ${epicLinkAdvisory}` : ""),
    data: {
      itemId: itemIdRaw,
      epicId: targetEpicSemantic,
      ...(epicLinkAdvisory ? { advisory: epicLinkAdvisory } : {}),
    },
  };
}

const handlers: Record<string, ToolPackHandler> = {
  create_backlog_item: (params, userId, context) => createBacklogItem(params, userId, context),
  triage_backlog_item: (params) => triageBacklogItem(params),
  retire_backlog_item: (params, userId, context) => retireBacklogItem(params, userId, context),
  size_backlog_item: (params) => sizeBacklogItem(params),
  process_backlog_for_build_studio: (params, userId, context) => processBacklogForBuildStudio(params, userId, context),
  update_backlog_item: (params, userId, context) =>
    handleUpdateBacklogItem(params, userId, context),
  query_backlog: (params) => queryBacklog(params),
  create_epic: (params, userId, context) => createEpic(params, userId, context),
  update_epic: (params, userId, context) => updateEpic(params, userId, context),
  list_epics: (params) => listEpics(params),
  list_backlog_items: (params) => listBacklogItems(params),
  get_backlog_item: (params) => getBacklogItem(params),
  update_backlog_item_status: (params, userId, context) => updateBacklogItemStatus(params, userId, context),
  link_backlog_item_to_epic: (params, userId, context) => linkBacklogItemToEpic(params, userId, context),
  get_next_recommended_work: (params) => getNextRecommendedWork(params),
};

export const backlogPack: ToolPack = {
  packId: "backlog",
  definitions,
  handlers,
  grants: {
    create_backlog_item: ["backlog_write"],
    triage_backlog_item: ["backlog_triage"],
    retire_backlog_item: ["backlog_write"],
    size_backlog_item: ["backlog_triage"],
    process_backlog_for_build_studio: ["build_lifecycle"],
    update_backlog_item: ["backlog_write"],
    query_backlog: ["backlog_read"],
    create_epic: ["backlog_write"],
    update_epic: ["backlog_write"],
    list_epics: ["backlog_read"],
    list_backlog_items: ["backlog_read"],
    get_backlog_item: ["backlog_read"],
    update_backlog_item_status: ["backlog_write"],
    link_backlog_item_to_epic: ["backlog_write"],
    get_next_recommended_work: ["backlog_read"],
  },
};
