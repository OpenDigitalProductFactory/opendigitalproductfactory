// Work-capture tool pack (BI-4C5F7A2D §9.6, slice 3b).
//
// Exposes the WorkEngagement lifecycle as MCP tools so a coworker can capture
// long-running/recurring work: create a recurring engagement (rule → materialized
// instances), advance its status, log timeline activity, and read its instances.
// Status transitions are gated by a DISTINCT grant (work_engagement_transition)
// because cancel/complete are higher-privilege than create. Grants mirror
// agent-grants.ts TOOL_TO_GRANTS (the gating source); tool-registry.test asserts
// no drift.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "create_recurring_work_engagement",
    description:
      "Establish a long-running, RECURRING work engagement: a parent work unit + an RFC-5545 recurrence rule, with occurrences materialized as tracked instances over a window. Use for work that repeats on a cadence (e.g. a campaign that publishes weekly). Timezone-aware (DST-correct). Re-running is idempotent — it tops up new occurrences without duplicating existing ones.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "What the recurring work is" },
        requestedOutcome: { type: "string", description: "Optional measurable outcome" },
        rrule: { type: "string", description: "RFC-5545 RRULE subset: FREQ DAILY|WEEKLY|MONTHLY, INTERVAL, BYDAY, COUNT|UNTIL" },
        timezone: { type: "string", description: "IANA timezone the cadence is evaluated in, e.g. America/New_York" },
        anchorAt: { type: "string", description: "ISO datetime of the first occurrence (DTSTART)" },
        until: { type: "string", description: "Optional ISO datetime bound for the series" },
        horizonDays: { type: "number", description: "How far ahead to materialize instances now (default 75)" },
      },
      required: ["title", "rrule", "timezone", "anchorAt"],
    },
    requiredCapability: "operate_marketing",
    sideEffect: true,
    coworkerArtifact: true,
  },
  {
    name: "transition_work_engagement",
    description:
      "Advance a work engagement's status through its lifecycle (planned → in-progress → completed | failed; cancellable until terminal). Idempotent — repeating the current status is a safe no-op. Every real transition is recorded on the engagement's activity timeline. Higher-privilege than create (includes cancel/complete).",
    inputSchema: {
      type: "object",
      properties: {
        engagementId: { type: "string", description: "WorkEngagement id" },
        to: { type: "string", description: "Target status: planned|in-progress|completed|cancelled|failed" },
        summary: { type: "string", description: "Optional note recorded with the transition" },
      },
      required: ["engagementId", "to"],
    },
    requiredCapability: "operate_marketing",
    sideEffect: true,
    coworkerArtifact: true,
  },
  {
    name: "record_work_engagement_activity",
    description:
      "Append an entry to a work engagement's activity timeline (a milestone, blocker, deliverable, or note). Ordered by a monotonic sequence so the log is a reliable append-only history of what happened on this long-running work.",
    inputSchema: {
      type: "object",
      properties: {
        engagementId: { type: "string", description: "WorkEngagement id" },
        kind: { type: "string", description: "e.g. milestone|blocker|deliverable|note" },
        summary: { type: "string", description: "Human-readable summary" },
        payload: { type: "object", description: "Optional structured detail" },
      },
      required: ["engagementId", "kind", "summary"],
    },
    requiredCapability: "operate_marketing",
    sideEffect: true,
    coworkerArtifact: true,
  },
  {
    name: "get_work_engagement_instances",
    description:
      "Read a recurring work engagement's materialized instances (occurrence date, due date, status, exception state), optionally filtered by status. Use to see what's scheduled/done across the series.",
    inputSchema: {
      type: "object",
      properties: {
        parentId: { type: "string", description: "Parent WorkEngagement id" },
        status: { type: "string", description: "Optional status filter" },
      },
      required: ["parentId"],
    },
    requiredCapability: "view_marketing",
    sideEffect: false,
  },
];

function isoOrUndef(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

async function createRecurringHandler(
  params: Record<string, unknown>,
  _userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const { createRecurringWorkEngagement } = await import("@/lib/marketing/work-engagement-org");
  const anchor = isoOrUndef(params["anchorAt"]);
  if (!anchor) return { success: false, error: "invalid-input", message: "anchorAt (ISO datetime) is required." };
  const result = await createRecurringWorkEngagement({
    title: String(params["title"] ?? ""),
    requestedOutcome: isoOrUndef(params["requestedOutcome"]),
    rrule: String(params["rrule"] ?? ""),
    timezone: String(params["timezone"] ?? "UTC"),
    anchorAt: anchor,
    until: isoOrUndef(params["until"]),
    horizonDays: typeof params["horizonDays"] === "number" ? params["horizonDays"] : undefined,
    createdByAgentId: context?.agentId ?? null,
  });
  if ("error" in result) return { success: false, error: result.error, message: result.message };
  return { success: true, entityId: result.parentId, message: result.message, data: result.data };
}

async function transitionHandler(
  params: Record<string, unknown>,
  _userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const { transitionWorkEngagement } = await import("@/lib/work-capture/work-engagement");
  const result = await transitionWorkEngagement({
    engagementId: String(params["engagementId"] ?? ""),
    to: String(params["to"] ?? "") as never,
    summary: isoOrUndef(params["summary"]),
    actor: { agentId: context?.agentId ?? null },
  });
  if ("error" in result) return { success: false, error: result.error, message: result.message };
  return { success: true, message: result.changed ? `Status → ${result.status}.` : `Already ${result.status} (no-op).` };
}

async function recordActivityHandler(
  params: Record<string, unknown>,
  _userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const { recordWorkEngagementActivity } = await import("@/lib/work-capture/work-engagement");
  const result = await recordWorkEngagementActivity({
    engagementId: String(params["engagementId"] ?? ""),
    kind: String(params["kind"] ?? "note"),
    summary: String(params["summary"] ?? ""),
    payload: params["payload"] && typeof params["payload"] === "object" ? (params["payload"] as Record<string, unknown>) : undefined,
    actor: { agentId: context?.agentId ?? null },
  });
  if ("error" in result) return { success: false, error: result.error, message: result.message };
  return { success: true, entityId: result.activityId, message: `Recorded activity #${result.seq}.` };
}

async function getInstancesHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { getWorkEngagementInstances } = await import("@/lib/work-capture/work-engagement");
  const result = await getWorkEngagementInstances(
    String(params["parentId"] ?? ""),
    { status: isoOrUndef(params["status"]) as never },
  );
  if ("error" in result) return { success: false, error: result.error, message: result.message };
  return { success: true, message: result.message, data: result.data };
}

export const workCapturePack: ToolPack = {
  packId: "work-capture",
  definitions,
  handlers: {
    create_recurring_work_engagement: (params, userId, context) => createRecurringHandler(params, userId, context),
    transition_work_engagement: (params, userId, context) => transitionHandler(params, userId, context),
    record_work_engagement_activity: (params, userId, context) => recordActivityHandler(params, userId, context),
    get_work_engagement_instances: (params) => getInstancesHandler(params),
  },
  grants: {
    create_recurring_work_engagement: ["work_engagement_write"],
    transition_work_engagement: ["work_engagement_transition"],
    record_work_engagement_activity: ["work_engagement_write"],
    get_work_engagement_instances: ["work_engagement_read"],
  },
};
