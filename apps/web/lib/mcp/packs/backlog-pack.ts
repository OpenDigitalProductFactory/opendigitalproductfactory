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
import { handleUpdateBacklogItem } from "@/lib/mcp-handlers/update-backlog-item";
import { updateBuildHappyPathState } from "@/lib/mcp/build-tool-helpers";
import {
  BACKLOG_SOURCE_VALUES,
  BACKLOG_STATUS_VALUES,
  BACKLOG_WORK_TYPE_VALUES,
  EPIC_STATUSES,
} from "@/lib/explore/backlog";
import type { BacklogIngestInput } from "@/lib/operate/backlog-ingest";
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";
import { tryAcquireBacklogClaimAtomic } from "@/lib/backlog/claim-on-start";

const definitions: ToolDefinition[] = [
  {
    name: "create_backlog_item",
    description: "Create a new backlog item in the ops backlog. Use this tool to add new items — do NOT use update_backlog_item for items that do not exist yet. New items default to status=triaging; supply status+triageOutcome together only when explicitly skipping triage (e.g. Build Studio brief intake). When triageOutcome=build, effortSize is required.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Item title" },
        type: { type: "string", enum: ["portfolio", "product"], description: "Item type" },
        status: { type: "string", enum: ["triaging", "open", "in-progress"], description: "Initial status (defaults to triaging). Non-triaging requires a paired triageOutcome." },
        triageOutcome: { type: "string", enum: ["build", "runbook", "coworker-task", "defer", "duplicate", "discard"], description: "Required when status is not triaging" },
        workType: { type: "string", enum: [...BACKLOG_WORK_TYPE_VALUES], description: "What kind of work this is (closed enum). bug == defect; feature == new capability; chore | doc | tool | skill | refactor for the corresponding work categories." },
        source: { type: "string", enum: [...BACKLOG_SOURCE_VALUES], description: "Intake origin — how did this item arrive. user-request (a human asked for it) or automated-detection (the platform observed it). Defaults to user-request when omitted." },
        proposedOutcome: { type: "string", enum: ["build", "runbook", "coworker-task", "defer", "duplicate", "discard"], description: "Advisory suggestion for Scrum Master triage (non-binding)" },
        priority: { type: "integer", description: "Optional ranked priority within the open pool (lower = higher priority)." },
        effortSize: { type: "string", enum: ["small", "medium", "large", "xlarge"], description: "Required when triageOutcome=build (skipping triage). Otherwise applied if provided." },
        body: { type: "string", description: "Detailed description" },
        epicId: { type: "string", description: "Epic ID to link to (optional)" },
        itemId: { type: "string", description: "Optional custom item ID (e.g. BI-PORT-005). Auto-generated if omitted." },
      },
      required: ["title", "type", "workType"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "triage_backlog_item",
    description: "Decide the outcome for a backlog item currently in status=triaging. Moves the item out of triage with a decided triageOutcome and supporting fields. Authority-gated via the backlog_triage grant category.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "The item ID (e.g. BI-E4A86393)" },
        outcome: { type: "string", enum: ["build", "runbook", "coworker-task", "defer", "duplicate", "discard"], description: "The triage decision" },
        rationale: { type: "string", description: "Short prose rationale for the decision" },
        effortSize: { type: "string", enum: ["small", "medium", "large", "xlarge"], description: "Required when outcome=build" },
        duplicateOfId: { type: "string", description: "Canonical item ID; required when outcome=duplicate" },
        reason: { type: "string", description: "Reason text; required when outcome=defer or outcome=discard" },
      },
      required: ["itemId", "outcome", "rationale"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "retire_backlog_item",
    description: "Retire a backlog item as duplicate, deferred, or discarded after review. Use this for governed cleanup of non-buildable or superseded items without requiring backlog triage authority.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "The item ID to retire (e.g. BI-E4A86393)" },
        outcome: { type: "string", enum: ["duplicate", "defer", "discard"], description: "The retirement decision" },
        rationale: { type: "string", description: "Short prose rationale for retiring the item" },
        duplicateOfId: { type: "string", description: "Canonical item ID; required when outcome=duplicate" },
        reason: { type: "string", description: "Optional reason text for defer/discard outcomes" },
      },
      required: ["itemId", "outcome", "rationale"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "size_backlog_item",
    description: "Assign effortSize to a backlog item. Useful when sizing is a follow-up step rather than part of a single triage commit.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "The item ID to size" },
        size: { type: "string", enum: ["small", "medium", "large", "xlarge"], description: "T-shirt size estimate" },
      },
      required: ["itemId", "size"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "process_backlog_for_build_studio",
    description: "Queue an on-demand governed backlog sweep that prepares eligible Build Studio drafts without auto-starting execution.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Optional cap for this on-demand sweep. Still constrained by the platform daily cap." },
      },
      required: [],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "update_backlog_item",
    description: "Update an existing backlog item's editable fields. Use update_backlog_item_status for triaged status transitions, triage_backlog_item to triage, size_backlog_item for effortSize, and link_backlog_item_to_epic for epic linkage — those have their own audit and validation.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "The item ID (e.g., BI-PORT-001)" },
        title: { type: "string", description: "New title" },
        status: { type: "string", enum: [...BACKLOG_STATUS_VALUES], description: "Update status. For triaged items only; use triage_backlog_item to leave triaging." },
        priority: { type: "number", description: "Priority number (lower = higher priority)" },
        body: { type: "string", description: "Updated description" },
        workType: { type: "string", enum: [...BACKLOG_WORK_TYPE_VALUES], description: "Reclassify what kind of work this is (closed enum)." },
        source: { type: "string", enum: [...BACKLOG_SOURCE_VALUES], description: "Reclassify the intake origin." },
        proposedOutcome: { type: "string", enum: ["build", "runbook", "coworker-task", "defer", "duplicate", "discard"], description: "Advisory recommendation; non-binding on triage" },
        digitalProductId: { type: "string", description: "Associate this item with a DigitalProduct by its productId (e.g. 'coworker-AGT-X'). The item's portfolio is then re-derived from the product (product first, then taxonomy node, then epic)." },
        taxonomyNodeId: { type: "string", description: "Associate this item with a portfolio taxonomy node by its nodeId (e.g. 'for_employees/financial_management'). Used to derive the portfolio when no product link exists." },
        portfolioSlug: { type: "string", description: "Directly pin the item's portfolio by root slug (e.g. 'for_employees'). Prefer digitalProductId/taxonomyNodeId so the link is structural; use this only for a deliberate override." },
      },
      required: ["itemId"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "query_backlog",
    description: "Query backlog items and epics. Returns items matching the filter criteria with status, priority, and epic information.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: [...BACKLOG_STATUS_VALUES], description: "Filter by status (optional)" },
        epicId: { type: "string", description: "Filter by epic ID (optional)" },
        limit: { type: "number", description: "Max results (default 20)" },
      },
      required: [],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate"],
  },
  {
    name: "create_epic",
    description: "Create a generic backlog epic through the governed MCP surface. Use this for roadmap/recovery/planning epics that are not tied to a live Build Studio build. Rejects duplicate semantic epic IDs; optional source/spec/plan/rationale context is captured by ToolExecution and indexed for discovery.",
    inputSchema: {
      type: "object",
      properties: {
        epicId: { type: "string", description: "Optional semantic epic id (e.g. EP-WWMD). Auto-generated if omitted." },
        title: { type: "string", description: "Epic title" },
        description: { type: "string", description: "Epic description" },
        status: { type: "string", enum: [...EPIC_STATUSES], description: "Initial epic status (defaults to open)" },
        priority: { type: "integer", description: "Optional ranked priority for the epic (lower = higher priority)" },
        owner: { type: "string", description: "Optional accountable employee identifier: EmployeeProfile id, employeeId, workEmail, personalEmail, or exact displayName" },
        source: { type: "string", enum: [...BACKLOG_SOURCE_VALUES], description: "What kind of gap or signal produced this epic" },
        specPath: { type: "string", description: "Optional related spec path for audit/index context" },
        planPath: { type: "string", description: "Optional related implementation plan path for audit/index context" },
        rationale: { type: "string", description: "Optional short rationale for creating the epic" },
      },
      required: ["title"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "update_epic",
    description: "Update a generic backlog epic's editable fields through the governed MCP surface. Use this for title, description, and status changes; status=done stamps completedAt, and reopening clears it.",
    inputSchema: {
      type: "object",
      properties: {
        epicId: { type: "string", description: "Semantic epic id (EP-*) or internal epic row id" },
        title: { type: "string", description: "New epic title" },
        description: { type: "string", description: "New epic description" },
        status: { type: "string", enum: [...EPIC_STATUSES], description: "New epic status" },
        priority: { type: "integer", description: "New ranked priority for the epic (lower = higher priority)" },
        specPath: { type: "string", description: "Optional related spec path for audit/index context" },
        planPath: { type: "string", description: "Optional related implementation plan path for audit/index context" },
        rationale: { type: "string", description: "Optional short rationale captured by ToolExecution" },
      },
      required: ["epicId"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "list_epics",
    description: "List epics with item-count rollups. Read-only. Filterable by status and whether the epic has open items. Returned epicId is the semantic id (EP-*), not the internal cuid.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "in-progress", "done"], description: "Filter by epic status" },
        hasOpenItems: { type: "boolean", description: "Only return epics that have at least one non-done item" },
        limit: { type: "number", description: "Max results (default 25, max 100)" },
      },
      required: [],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "list_backlog_items",
    description: "List backlog items filtered by status, type, workType, source, epic, claim state, or active-build state. Read-only. Returns semantic IDs (BI-*, EP-*) — never cuids.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["triaging", "open", "in-progress", "done", "deferred"] },
        type: { type: "string", enum: ["portfolio", "product"] },
        workType: { type: "string", enum: [...BACKLOG_WORK_TYPE_VALUES], description: "Filter by work-type (bug | feature | chore | doc | tool | skill | refactor)." },
        source: { type: "string", enum: [...BACKLOG_SOURCE_VALUES], description: "Filter by intake origin (user-request | automated-detection)." },
        epicId: { type: "string", description: "Semantic epic id (EP-*) to filter to" },
        unclaimed: { type: "boolean", description: "Only items with no user/agent claim" },
        hasActiveBuild: { type: "boolean", description: "Only items currently linked to a Build Studio build" },
        limit: { type: "number", description: "Max results (default 25, max 100)" },
      },
      required: [],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "get_backlog_item",
    description: "Fetch one backlog item by semantic id with linked epic, digital product, active build, and the most recent activity entries. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "Semantic backlog item id (e.g. BI-PORT-005)" },
      },
      required: ["itemId"],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "update_backlog_item_status",
    description: "Move a backlog item between lifecycle statuses. Enforces the legal-transition table; same-status calls are no-op successes. Setting status='triaging' on an already-triaged item is the *retriage* path — clears triageOutcome and effortSize so triage_backlog_item can re-decide. Setting status='done' requires a resolution. Writes a status_change activity row and may auto-close the parent epic. Moving an item to in-progress ACQUIRES its work claim and is rejected with error=claim_conflict if another session already holds a fresh active claim (pass force=true to take it over); the claim is released when the item leaves in-progress. NOTE: this only changes the status field — it does NOT start work. For a triageOutcome=build item, starting the work means promote_to_build_studio (creates the FeatureBuild + Build Studio Ideate); flipping such an item to in-progress returns an advisory and does not build anything.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "Semantic backlog item id" },
        status: { type: "string", enum: ["triaging", "open", "in-progress", "done", "deferred"], description: "Target status. 'triaging' from a triaged status is allowed and clears the prior triage decision." },
        reason: { type: "string", description: "Free-text rationale captured in the activity row. Required when status=triaging from a triaged status." },
        resolution: { type: "string", description: "Outcome summary, required when status=done" },
        force: { type: "boolean", description: "When moving to in-progress, take over a claim already held by another active session (default false). The takeover is recorded on the status_change activity row." },
      },
      required: ["itemId", "status"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "link_backlog_item_to_epic",
    description: "Link a backlog item to an epic (or unlink with epicId=null). Recomputes target epic status — if a done epic gains a new open item, it flips back to open. Writes an epic_link activity row. NOTE: linking is organizational only — it does NOT triage the item (use triage_backlog_item) and does NOT promote it or create a build (use promote_to_build_studio). Linking an untriaged/unpromoted item returns an advisory; never report an epic link as 'triaged' or 'promoted'.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "Semantic backlog item id" },
        epicId: { type: "string", description: "Semantic epic id (EP-*), or empty string / 'null' to unlink" },
      },
      required: ["itemId"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "get_next_recommended_work",
    description: "Return a short ranked list of backlog items the caller could pick up next. Ranks by spec/plan presence, triage outcome, effort size, priority, and active-build state. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        count: { type: "number", description: "How many recommendations to return (default 3, max 10)" },
        epicId: { type: "string", description: "Restrict to one epic" },
        forAgentId: { type: "string", description: "Only items grant-claimable by this agent" },
        excludeItemIds: { type: "array", items: { type: "string" }, description: "Items to skip (already considered or rejected)" },
      },
      required: [],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
  },
];

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
    return { success: true, entityId: result.itemId, message: `Created backlog item ${result.itemId}` };
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.message.replace(/^\[backlog-ingest\]\s*/, "")
        : "Failed to create backlog item";
    return { success: false, error: msg, message: msg };
  }
}

async function triageBacklogItem(params: Record<string, unknown>): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const itemId = String(params["itemId"] ?? "");
  const outcome = String(params["outcome"] ?? "");
  const rationale = String(params["rationale"] ?? "").trim();
  const item = await prisma.backlogItem.findUnique({ where: { itemId } });
  if (!item) {
    return { success: false, error: "Item not found", message: `Item ${itemId} not found` };
  }
  if (item.status !== "triaging") {
    return { success: false, error: "Item is not in triaging status", message: `Item ${itemId} is not in triaging status` };
  }
  if (!rationale) {
    return { success: false, error: "Rationale is required", message: "Rationale is required" };
  }
  if (outcome === "build" && typeof params["effortSize"] !== "string") {
    return { success: false, error: "effortSize is required for build outcomes", message: "effortSize is required for build outcomes" };
  }
  if (outcome === "duplicate" && typeof params["duplicateOfId"] !== "string") {
    return { success: false, error: "duplicateOfId is required for duplicate outcomes", message: "duplicateOfId is required for duplicate outcomes" };
  }
  if ((outcome === "defer" || outcome === "discard") && typeof params["reason"] !== "string") {
    return { success: false, error: "reason is required for defer/discard outcomes", message: "reason is required for defer/discard outcomes" };
  }

  const nextStatus =
    outcome === "build" || outcome === "runbook" || outcome === "coworker-task"
      ? "open"
      : "deferred";

  await prisma.backlogItem.update({
    where: { itemId },
    data: {
      status: nextStatus,
      triageOutcome: outcome,
      effortSize: typeof params["effortSize"] === "string" ? params["effortSize"] : null,
      duplicateOfId: typeof params["duplicateOfId"] === "string" ? params["duplicateOfId"] : null,
      resolution: rationale,
      abandonReason: typeof params["reason"] === "string" ? params["reason"] : null,
    },
  });

  return {
    success: true,
    entityId: itemId,
    message: `Triaged ${itemId} as ${outcome}`,
  };
}

async function retireBacklogItem(
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

  if (!itemId) {
    return { success: false, error: "missing_itemId", message: "itemId is required" };
  }
  if (!validOutcomes.has(outcome)) {
    return { success: false, error: "invalid_outcome", message: "outcome must be duplicate, defer, or discard" };
  }
  if (!rationale) {
    return { success: false, error: "missing_rationale", message: "rationale is required" };
  }
  if (outcome === "duplicate" && !duplicateOfId) {
    return { success: false, error: "missing_duplicateOfId", message: "duplicateOfId is required for duplicate retirement" };
  }

  const result = await prisma.$transaction(async (tx) => {
    const item = await tx.backlogItem.findUnique({ where: { itemId } });
    if (!item) {
      return { success: false, error: "not_found", message: `Item ${itemId} not found` } satisfies ToolResult;
    }
    if ("activeBuildId" in item && item.activeBuildId) {
      return {
        success: false,
        error: "active_build_exists",
        message: `Item ${itemId} is attached to an active build and cannot be retired`,
      } satisfies ToolResult;
    }

    let canonicalRowId: string | null = null;
    if (outcome === "duplicate") {
      const canonical = await tx.backlogItem.findUnique({ where: { itemId: duplicateOfId } });
      if (!canonical) {
        return {
          success: false,
          error: "duplicate_not_found",
          message: `Canonical item ${duplicateOfId} not found`,
        } satisfies ToolResult;
      }
      canonicalRowId = canonical.id;
    }

    const updated = await tx.backlogItem.update({
      where: { id: item.id },
      data: {
        status: "deferred",
        triageOutcome: outcome,
        duplicateOfId: canonicalRowId,
        resolution: rationale,
        abandonReason: reason || rationale,
        completedAt: new Date(),
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
          to: "deferred",
          outcome,
          rationale,
          reason: reason || null,
          duplicateOfId: outcome === "duplicate" ? duplicateOfId : null,
        },
      },
    });

    if (item.epicId) {
      const remainingOpenItems = await tx.backlogItem.count({
        where: {
          epicId: item.epicId,
          status: { in: ["open", "in-progress"] },
          id: { not: item.id },
        },
      });
      if (remainingOpenItems === 0) {
        await tx.epic.update({
          where: { id: item.epicId },
          data: { status: "done" },
        });
      }
    }

    return {
      success: true,
      entityId: updated.itemId,
      message: `Retired ${itemId} as ${outcome}`,
      data: {
        itemId: updated.itemId,
        status: "deferred",
        outcome,
        duplicateOfId: outcome === "duplicate" ? duplicateOfId : null,
      },
    } satisfies ToolResult;
  });

  return result;
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

async function queryBacklog(params: Record<string, unknown>): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const where: Record<string, unknown> = {};
  if (typeof params["status"] === "string") where["status"] = params["status"];
  if (typeof params["epicId"] === "string") where["epicId"] = params["epicId"];
  const limit = typeof params["limit"] === "number" ? Math.min(params["limit"], 50) : 20;

  const [items, epics, totalOpen, totalInProgress, totalDone] = await Promise.all([
    prisma.backlogItem.findMany({
      where,
      orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
      take: limit,
      select: { itemId: true, title: true, status: true, type: true, priority: true, epicId: true, updatedAt: true },
    }),
    prisma.epic.findMany({
      select: { id: true, epicId: true, title: true, status: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.backlogItem.count({ where: { status: "open" } }),
    prisma.backlogItem.count({ where: { status: "in-progress" } }),
    prisma.backlogItem.count({ where: { status: "done" } }),
  ]);

  const summary = `Backlog: ${totalOpen} open, ${totalInProgress} in-progress, ${totalDone} done. ${epics.length} epic(s).`;
  return {
    success: true,
    message: summary,
    data: {
      summary: { open: totalOpen, inProgress: totalInProgress, done: totalDone },
      epics: epics.map((e) => ({ epicId: e.epicId, title: e.title, status: e.status })),
      items: items.map((i) => ({ itemId: i.itemId, title: i.title, status: i.status, type: i.type, priority: i.priority, epicId: i.epicId })),
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

async function updateEpic(params: Record<string, unknown>): Promise<ToolResult> {
  const { updateEpicTool } = await import("@/lib/backlog/mcp-epic-tools");
  return updateEpicTool(params);
}

async function listEpics(params: Record<string, unknown>): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const where: Record<string, unknown> = {};
  if (typeof params["status"] === "string") where["status"] = params["status"];
  const limit = typeof params["limit"] === "number" ? Math.min(Math.max(1, params["limit"]), 100) : 25;
  const epics = await prisma.epic.findMany({
    where,
    take: limit,
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      epicId: true,
      title: true,
      status: true,
      priority: true,
      updatedAt: true,
      items: { select: { status: true } },
    },
  });
  const wantOpenItems = params["hasOpenItems"] === true;
  const { buildSpecPlanReferenceIndex } = await import("@/lib/backlog/spec-plan-search");
  const refIndex = await buildSpecPlanReferenceIndex();
  const data = epics
    .map((e) => {
      const total = e.items.length;
      const open = e.items.filter((it) => it.status === "open").length;
      const inProgress = e.items.filter((it) => it.status === "in-progress").length;
      const done = e.items.filter((it) => it.status === "done").length;
      return {
        epicId: e.epicId,
        title: e.title,
        status: e.status,
        priority: e.priority,
        itemCount: { total, open, inProgress, done },
        hasSpec: refIndex.specs.has(e.epicId) || refIndex.plans.has(e.epicId),
        updatedAt: e.updatedAt.toISOString(),
        _hasOpen: open + inProgress > 0,
      };
    })
    .filter((row) => (wantOpenItems ? row._hasOpen : true))
    .map((row) => {
      const { _hasOpen, ...rest } = row;
      void _hasOpen;
      return rest;
    });
  return {
    success: true,
    message: `Listed ${data.length} epic(s).`,
    data: { epics: data },
  };
}

async function listBacklogItems(params: Record<string, unknown>): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const where: Record<string, unknown> = {};
  if (typeof params["status"] === "string") where["status"] = params["status"];
  if (typeof params["type"] === "string") where["type"] = params["type"];
  if (typeof params["workType"] === "string") where["workType"] = params["workType"];
  if (typeof params["source"] === "string") where["source"] = params["source"];
  if (typeof params["epicId"] === "string" && params["epicId"].trim()) {
    const epicRow = await prisma.epic.findFirst({
      where: { OR: [{ epicId: params["epicId"].trim() }, { id: params["epicId"].trim() }] },
      select: { id: true },
    });
    if (epicRow) where["epicId"] = epicRow.id;
    else
      return {
        success: false,
        error: "epic_not_found",
        message: `No epic matched ${params["epicId"]}`,
      };
  }
  if (params["unclaimed"] === true) {
    where["claimedById"] = null;
    where["claimedByAgentId"] = null;
  }
  if (params["hasActiveBuild"] === true) where["activeBuildId"] = { not: null };
  else if (params["hasActiveBuild"] === false) where["activeBuildId"] = null;

  const limit = typeof params["limit"] === "number" ? Math.min(Math.max(1, params["limit"]), 100) : 25;
  const items = await prisma.backlogItem.findMany({
    where,
    take: limit,
    orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
    select: {
      itemId: true,
      title: true,
      status: true,
      type: true,
      workType: true,
      source: true,
      priority: true,
      effortSize: true,
      demandStage: true,
      demandScore: true,
      demandScoreFramework: true,
      activeBuildId: true,
      updatedAt: true,
      triageOutcome: true,
      epic: { select: { epicId: true } },
      activeBuild: { select: { phase: true, draftApprovedAt: true } },
    },
  });
  const { deriveLifecycleLabel } = await import("@/lib/governed-backlog-workflow");
  const data = items.map((i) => ({
    itemId: i.itemId,
    title: i.title,
    status: i.status,
    type: i.type,
    workType: i.workType,
    source: i.source,
    priority: i.priority,
    effortSize: i.effortSize,
    demandStage: i.demandStage,
    demandScore: i.demandScore,
    demandScoreFramework: i.demandScoreFramework,
    triageOutcome: i.triageOutcome,
    epicId: i.epic?.epicId ?? null,
    hasActiveBuild: i.activeBuildId != null,
    lifecycleLabel: deriveLifecycleLabel({
      backlogItem: { status: i.status, triageOutcome: i.triageOutcome, activeBuildId: i.activeBuildId },
      featureBuild: i.activeBuild
        ? { phase: i.activeBuild.phase, draftApprovedAt: i.activeBuild.draftApprovedAt }
        : null,
      governedBacklogEnabled: true,
    }),
    updatedAt: i.updatedAt.toISOString(),
  }));
  return {
    success: true,
    message: `Listed ${data.length} backlog item(s).`,
    data: { items: data },
  };
}

async function getBacklogItem(params: Record<string, unknown>): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const itemIdRaw = String(params["itemId"] ?? "").trim();
  if (!itemIdRaw)
    return { success: false, error: "missing_itemId", message: "itemId is required" };
  const item = await prisma.backlogItem.findUnique({
    where: { itemId: itemIdRaw },
    include: {
      epic: { select: { epicId: true, title: true, status: true } },
      digitalProduct: { select: { productId: true, name: true } },
      activeBuild: {
        select: {
          buildId: true,
          phase: true,
          draftApprovedAt: true,
          sandboxId: true,
          createdAt: true,
        },
      },
      activities: {
        orderBy: { recordedAt: "desc" },
        take: 10,
      },
    },
  });
  if (!item)
    return { success: false, error: "not_found", message: `Item ${itemIdRaw} not found` };
  const { deriveLifecycleLabel } = await import("@/lib/governed-backlog-workflow");
  const { searchSpecsAndPlans } = await import("@/lib/backlog/spec-plan-search");
  const specPlanRefs = await searchSpecsAndPlans({
    query: itemIdRaw,
    itemId: itemIdRaw,
    matches: 10,
  });
  return {
    success: true,
    message: `Loaded ${item.itemId}`,
    data: {
      itemId: item.itemId,
      title: item.title,
      status: item.status,
      type: item.type,
      workType: item.workType,
      source: item.source,
      priority: item.priority,
      effortSize: item.effortSize,
      triageOutcome: item.triageOutcome,
      body: item.body ?? null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      completedAt: item.completedAt ? item.completedAt.toISOString() : null,
      lifecycleLabel: deriveLifecycleLabel({
        backlogItem: {
          status: item.status,
          triageOutcome: item.triageOutcome,
          activeBuildId: item.activeBuildId,
        },
        featureBuild: item.activeBuild
          ? { phase: item.activeBuild.phase, draftApprovedAt: item.activeBuild.draftApprovedAt }
          : null,
        governedBacklogEnabled: true,
      }),
      epic: item.epic
        ? { epicId: item.epic.epicId, title: item.epic.title, status: item.epic.status }
        : null,
      digitalProduct: item.digitalProduct
        ? { productId: item.digitalProduct.productId, name: item.digitalProduct.name }
        : null,
      activeBuild: item.activeBuild
        ? {
            buildId: item.activeBuild.buildId,
            phase: item.activeBuild.phase,
            draftApprovedAt: item.activeBuild.draftApprovedAt
              ? item.activeBuild.draftApprovedAt.toISOString()
              : null,
            sandboxId: item.activeBuild.sandboxId,
          }
        : null,
      specPlanFiles: specPlanRefs.map((r) => ({
        path: r.path,
        kind: r.kind,
        title: r.title,
        date: r.date,
      })),
      recentActivity: item.activities.map((a) => ({
        id: a.id,
        kind: a.kind,
        summary: a.summary,
        recordedAt: a.recordedAt.toISOString(),
        payload: a.payload,
      })),
    },
  };
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
      message: `status must be one of triaging|open|in-progress|done|deferred, got ${target}`,
    };
  const reason = typeof params["reason"] === "string" ? params["reason"] : null;
  const resolution = typeof params["resolution"] === "string" ? params["resolution"] : null;
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
  if (item.status === target) {
    return {
      success: true,
      entityId: itemIdRaw,
      message: `${itemIdRaw} already at status=${target} (no-op)`,
    };
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
    const next = await tx.backlogItem.update({
      where: { id: item.id },
      data: {
        status: target,
        ...(target === "done" ? { completedAt: new Date(), resolution } : {}),
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
        kind: "status_change",
        summary: `${item.status} → ${target}` + (reason ? ` — ${reason.slice(0, 160)}` : ""),
        payload: {
          from: item.status,
          to: target,
          reason: reason ?? null,
          resolution: resolution ?? null,
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
    // Epic auto-close: when this item just reached done and every sibling is done/deferred,
    // flip the epic to done. Mirrors AGENTS.md Epic Lifecycle Stewardship.
    if (target === "done" && item.epicId) {
      const remaining = await tx.backlogItem.count({
        where: {
          epicId: item.epicId,
          id: { not: item.id },
          status: { notIn: ["done", "deferred"] },
        },
      });
      if (remaining === 0) {
        await tx.epic.update({
          where: { id: item.epicId },
          data: { status: "done", completedAt: new Date() },
        });
      }
    }
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

async function getNextRecommendedWork(params: Record<string, unknown>): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const { rankCandidates } = await import("@/lib/backlog/recommend");
  const { buildSpecPlanReferenceIndex } = await import("@/lib/backlog/spec-plan-search");

  const count = typeof params["count"] === "number" ? params["count"] : undefined;
  const epicIdRaw = typeof params["epicId"] === "string" ? params["epicId"].trim() : "";
  const forAgentId = typeof params["forAgentId"] === "string" ? params["forAgentId"] : null;
  const excludeItemIds = Array.isArray(params["excludeItemIds"])
    ? (params["excludeItemIds"] as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  const where: Record<string, unknown> = {
    status: { in: ["open", "triaging"] },
  };
  if (epicIdRaw) {
    const epicRow = await prisma.epic.findFirst({
      where: { OR: [{ epicId: epicIdRaw }, { id: epicIdRaw }] },
      select: { id: true },
    });
    if (epicRow) where["epicId"] = epicRow.id;
    else
      return {
        success: false,
        error: "epic_not_found",
        message: `No epic matched ${epicIdRaw}`,
      };
  }

  const items = await prisma.backlogItem.findMany({
    where,
    take: 200,
    orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
    select: {
      itemId: true,
      title: true,
      status: true,
      priority: true,
      demandScore: true,
      effortSize: true,
      triageOutcome: true,
      activeBuildId: true,
      claimedById: true,
      claimedByAgentId: true,
      updatedAt: true,
      epic: { select: { epicId: true, status: true } },
    },
  });

  const refIndex = await buildSpecPlanReferenceIndex();
  const candidates = items.map((i) => {
    const semanticEpic = i.epic?.epicId ?? null;
    const hasSpec =
      refIndex.specs.has(i.itemId) || (semanticEpic ? refIndex.specs.has(semanticEpic) : false);
    const hasPlan =
      refIndex.plans.has(i.itemId) || (semanticEpic ? refIndex.plans.has(semanticEpic) : false);
    return {
      itemId: i.itemId,
      title: i.title,
      status: i.status,
      priority: i.priority,
      demandScore: i.demandScore,
      effortSize: i.effortSize,
      triageOutcome: i.triageOutcome,
      hasActiveBuild: i.activeBuildId != null,
      claimedById: i.claimedById,
      claimedByAgentId: i.claimedByAgentId,
      epicId: semanticEpic,
      epicStatus: i.epic?.status ?? null,
      hasSpec,
      hasPlan,
      updatedAt: i.updatedAt,
    };
  });

  const ranked = rankCandidates(candidates, {
    excludeItemIds,
    forAgentId,
    count,
  });

  return {
    success: true,
    message: `Recommending ${ranked.length} item(s).`,
    data: { recommendations: ranked },
  };
}

const handlers: Record<string, ToolPackHandler> = {
  create_backlog_item: (params, userId, context) => createBacklogItem(params, userId, context),
  triage_backlog_item: (params) => triageBacklogItem(params),
  retire_backlog_item: (params, userId, context) => retireBacklogItem(params, userId, context),
  size_backlog_item: (params) => sizeBacklogItem(params),
  process_backlog_for_build_studio: (params, userId, context) => processBacklogForBuildStudio(params, userId, context),
  update_backlog_item: (params) => handleUpdateBacklogItem(params),
  query_backlog: (params) => queryBacklog(params),
  create_epic: (params, userId, context) => createEpic(params, userId, context),
  update_epic: (params) => updateEpic(params),
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
