import type { ToolDefinition } from "@/lib/mcp-tools";
import {
  backlogScopeCreateProperties,
  backlogScopeFilterProperties,
  backlogScopeUpdateProperties,
  backlogProductScopeCreateProperties,
  backlogProductScopeUpdateProperties,
} from "./backlog-scope-metadata";
import {
  BACKLOG_SOURCE_VALUES,
  BACKLOG_STATUS_VALUES,
  BACKLOG_WORK_TYPE_VALUES,
  EPIC_STATUSES,
} from "@/lib/explore/backlog";
import { DEFERRAL_INPUT_SCHEMA } from "@/lib/backlog/deferral-contract";
import { backlogStatusToolDefinition } from "./backlog-status-tool-definition";

export const backlogPackDefinitions: ToolDefinition[] = [
  {
    name: "create_backlog_item",
    description:
      "Create a new backlog item in the ops backlog. Use this tool to add new items — do NOT use update_backlog_item for items that do not exist yet. " +
      "New items default to status=triaging; supply status+triageOutcome together only when explicitly skipping triage (e.g. Build Studio brief intake). When triageOutcome=build, effortSize is required. " +
      "Before creating: list_backlog_items or search_knowledge for an existing BI on the same defect. " +
      "Do not create-then-recreate on transient errors; read the error and fix the payload once.",
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
        ...backlogScopeCreateProperties,
        ...backlogProductScopeCreateProperties,
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
        deferral: DEFERRAL_INPUT_SCHEMA,
      },
      required: ["itemId", "outcome", "rationale"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "retire_backlog_item",
    description: "Remove a backlog item from executable demand as duplicate or discarded, or retain it as a governed deferral. Deferred outcomes require an owner, trigger, and review horizon.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "The item ID to retire (e.g. BI-E4A86393)" },
        outcome: { type: "string", enum: ["duplicate", "defer", "discard"], description: "The retirement decision" },
        rationale: { type: "string", description: "Short prose rationale for retiring the item" },
        duplicateOfId: { type: "string", description: "Canonical item ID; required when outcome=duplicate" },
        reason: { type: "string", description: "Optional reason text for defer/discard outcomes" },
        deferral: DEFERRAL_INPUT_SCHEMA,
      },
      required: ["itemId", "outcome", "rationale"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
    consequence: "irreversible",
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
        ...backlogScopeUpdateProperties,
        ...backlogProductScopeUpdateProperties,
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
    description:
      "Query backlog items and epics. Returns items matching the filter criteria with status, priority, and epic information. " +
      "Prefer list_backlog_items when you only need item rows with workType/claim filters. " +
      "Prefer get_next_recommended_work for \"what should I pick next\". " +
      "Do not poll query_backlog in a tight loop — responses include total/truncated; widen filters or raise limit once instead of thrashing.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: [...BACKLOG_STATUS_VALUES], description: "Filter by status (optional)" },
        deferralConformance: { type: "string", enum: ["compliant", "nonconformant"], description: "Filter deferred items by whether all required active-deferral fields are present." },
        deferralReviewDueBefore: { type: "string", description: "Return deferred items whose reviewAt is on or before this ISO-8601 timestamp." },
        epicId: { type: "string", description: "Filter by semantic epic id (EP-*) or internal epic row id (optional). Returns epic_not_found rather than an empty list when it matches nothing." },
        ...backlogScopeFilterProperties,
        limit: { type: "number", description: "Max results (default 100, max 1000). Responses always report `total` and `truncated`." },
      },
      required: [],
    },
    title: "Query backlog",
    outputSchema: {
      type: "object",
      properties: {
        items: { type: "array", items: { type: "object" } },
        epics: { type: "array", items: { type: "object" } },
        total: { type: "number" },
        truncated: { type: "boolean" },
      },
      required: ["items", "total", "truncated"],
      additionalProperties: true,
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
        ...backlogScopeCreateProperties,
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
    description: "Update a generic backlog epic through the governed MCP surface. status=done is allowed only after the canonical receipt anchor, child delivery, and objective evidence reconcile.",
    inputSchema: {
      type: "object",
      properties: {
        epicId: { type: "string", description: "Semantic epic id (EP-*) or internal epic row id" },
        title: { type: "string", description: "New epic title" },
        description: { type: "string", description: "New epic description" },
        status: { type: "string", enum: [...EPIC_STATUSES], description: "New epic status" },
        priority: { type: "integer", description: "New ranked priority for the epic (lower = higher priority)" },
        ...backlogScopeUpdateProperties,
        specPath: { type: "string", description: "Optional related spec path for audit/index context" },
        planPath: { type: "string", description: "Optional related implementation plan path for audit/index context" },
        rationale: { type: "string", description: "Optional short rationale captured by ToolExecution" },
        originatingBacklogItemId: { type: "string", description: "Optional BI-* or row id to converge as this Epic's canonical readiness-receipt anchor. Existing conflicting anchors are refused." },
      },
      required: ["epicId"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "list_epics",
    description:
      "List epics with item-count rollups. Read-only. Filterable by status and whether the epic has open items. Returned epicId is the semantic id (EP-*), not the internal cuid. " +
      "Prefer one filtered list (status/hasOpenItems/limit) over re-listing the full catalog for every decision.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "in-progress", "done"], description: "Filter by epic status" },
        hasOpenItems: { type: "boolean", description: "Only return epics that have at least one non-done item" },
        ...backlogScopeFilterProperties,
        limit: { type: "number", description: "Max results (default 100, max 1000). Responses always report `total` and `truncated`, so a short list is never mistaken for a complete one." },
      },
      required: [],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "list_backlog_items",
    description:
      "List backlog items filtered by status, type, workType, source, epic, claim state, or active-build state. Read-only. Returns semantic IDs (BI-*, EP-*) — never cuids. " +
      "Prefer one filtered list over many get_backlog_item calls when scanning the pool (list carries status, effort, epic, claim). " +
      "Use status+unclaimed+limit; honor total/truncated instead of re-listing the same page.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: [...BACKLOG_STATUS_VALUES] },
        deferralConformance: { type: "string", enum: ["compliant", "nonconformant"], description: "Filter deferred items by whether all required active-deferral fields are present." },
        deferralReviewDueBefore: { type: "string", description: "Return deferred items whose reviewAt is on or before this ISO-8601 timestamp." },
        type: { type: "string", enum: ["portfolio", "product"] },
        workType: { type: "string", enum: [...BACKLOG_WORK_TYPE_VALUES], description: "Filter by work-type (bug | feature | chore | doc | tool | skill | refactor)." },
        source: { type: "string", enum: [...BACKLOG_SOURCE_VALUES], description: "Filter by intake origin (user-request | automated-detection)." },
        epicId: { type: "string", description: "Semantic epic id (EP-*) to filter to" },
        ...backlogScopeFilterProperties,
        unclaimed: { type: "boolean", description: "Only items with no user/agent claim" },
        hasActiveBuild: { type: "boolean", description: "Only items currently linked to a Build Studio build" },
        evidenceNotCounted: { type: "boolean", description: "Only items holding recorded execution evidence but no initiative gate receipt — work that was done and recorded into a lane readiness does not read. Use this to reconcile items stalled by the evidence/receipt split rather than by missing work." },
        limit: { type: "number", description: "Max results (default 100, max 1000). Responses always report `total` and `truncated`, so a short list is never mistaken for a complete one." },
      },
      required: [],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "get_backlog_item",
    description:
      "Fetch ONE backlog item by semantic id with body, demand activation readiness, evidence links, linked epic, active build, and recent activity. Read-only. " +
      "Do NOT poll this tool in a loop for many IDs — use list_backlog_items (filters + total/truncated) for scanning, then get_backlog_item only for the few items you will actually open — avoid N+1 status polling. " +
      "Not a webhook; there is no push for status changes — re-list with filters instead of thrashing get.",
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
  backlogStatusToolDefinition,
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
    description:
      "Return a short ranked list of backlog items the caller could pick up next. Design-candidate mode keeps provisional work visible with Continue design; implementation-ready mode returns only initiatives allowed by the canonical readiness policy. Textual spec/plan references are hints, never proof of implementation readiness. Read-only. " +
      "Call once at session start (or after finishing a BI); pass excludeItemIds for rejected candidates instead of re-polling without filters.",
    inputSchema: {
      type: "object",
      properties: {
        count: { type: "number", description: "How many recommendations to return (default 3, max 10)" },
        epicId: { type: "string", description: "Restrict to one epic" },
        forAgentId: { type: "string", description: "Only items grant-claimable by this agent" },
        excludeItemIds: { type: "array", items: { type: "string" }, description: "Items to skip (already considered or rejected)" },
        mode: { type: "string", enum: ["design-candidate", "implementation-ready"], description: "Recommendation intent. Defaults to design-candidate; implementation-ready fails closed to policy-allowed initiatives only." },
      },
      required: [],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
  },
];
