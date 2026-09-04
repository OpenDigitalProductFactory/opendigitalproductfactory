// Feedback tool pack — BI-ARCH-TOOLPACKS.
//
// Fifth domain pack, and the first extraction of *inline* handler bodies (the
// four prior packs each wrapped a sibling handler module). The three
// platform-feedback tools were inline switch cases:
//   - report_quality_issue        -> createPlatformIssueReport (thin delegation)
//   - escalate_feedback_upstream  -> escalateReportUpstream    (thin delegation)
//   - register_tech_debt          -> createTechDebtItem + a direct prisma write
// Each handler lazy-imports its dependency and reproduces the former switch case
// verbatim. register_tech_debt reads context.agentId, so ToolPackHandler's context
// was widened to expose it (the registry already forwards the full runtime
// ToolExecutionContext). Definitions moved verbatim out of the inline
// PLATFORM_TOOLS array; grants mirror TOOL_TO_GRANTS.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "report_quality_issue",
    description: "Report a bug, suggestion, or question about the platform. Available to ALL employees regardless of role — anyone can report a problem.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["runtime_error", "user_report", "feedback"], description: "Issue type" },
        title: { type: "string", description: "Short summary" },
        description: { type: "string", description: "Detailed description" },
        severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
      },
      required: ["type", "title"],
    },
    requiredCapability: null,
    sideEffect: true,
  },
  {
    name: "escalate_feedback_upstream",
    description:
      "Send a previously-captured platform issue report to the upstream project team as a GitHub issue, if this install has opted in to upstream feedback. Use after a user asks to share their report/feedback with the platform maintainers. Submitted under the install's anonymous handle with machine names redacted; respects opt-in consent, fork_only, and the contributions pause. Idempotent per report.",
    inputSchema: {
      type: "object",
      properties: {
        reportId: { type: "string", description: "The PlatformIssueReport id (e.g. PIR-AB12C) to escalate." },
      },
      required: ["reportId"],
    },
    requiredCapability: null,
    sideEffect: true,
    consequence: "outward",
  },
  {
    name: "register_tech_debt",
    description: "Log a technical shortcut as a refactoring backlog item.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
      },
      required: ["title", "description"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
  },
];

async function reportQualityIssue(
  params: Record<string, unknown>,
  userId: string,
  context?: { routeContext?: string; threadId?: string },
): Promise<ToolResult> {
  const { createPlatformIssueReport } = await import("@/lib/quality/platform-issue-reports");
  const { reportId } = await createPlatformIssueReport({
    type: String(params["type"] ?? "user_report"),
    title: String(params["title"] ?? "Untitled"),
    source: "ai_assisted",
    ...(typeof params["description"] === "string" ? { description: params["description"] } : {}),
    severity: String(params["severity"] ?? "medium"),
    reportedById: userId,
    ...(typeof context?.routeContext === "string" ? { routeContext: context.routeContext } : {}),
  });
  return { success: true, entityId: reportId, message: `Filed report ${reportId}` };
}

async function escalateFeedbackUpstream(params: Record<string, unknown>): Promise<ToolResult> {
  const reportId = String(params["reportId"] ?? "").trim();
  if (!reportId) {
    return { success: false, error: "reportId is required", message: "reportId is required" };
  }
  const { escalateReportUpstream } = await import("@/lib/actions/feedback-escalation");
  const result = await escalateReportUpstream({ reportId });
  if (result.ok) {
    return {
      success: true,
      ...(result.status === "filed" || result.status === "already-filed"
        ? { entityId: String(result.issueNumber ?? reportId) }
        : {}),
      message:
        result.status === "already-filed"
          ? `Report ${reportId} was already sent to the project team${result.url ? ` (${result.url})` : ""}.`
          : `Sent ${reportId} to the project team${result.url ? ` (${result.url})` : ""}.`,
    };
  }
  return { success: false, error: result.reason, message: result.reason };
}

async function registerTechDebt(
  params: Record<string, unknown>,
  userId: string,
  context?: { routeContext?: string; threadId?: string; agentId?: string },
): Promise<ToolResult> {
  const { createTechDebtItem } = await import("@/lib/decomposition");
  const { prisma } = await import("@dpf/db");
  const item = createTechDebtItem({
    title: String(params["title"] ?? ""),
    description: String(params["description"] ?? ""),
    severity: String(params["severity"] ?? "medium"),
  });
  const refactorEpic = await prisma.epic.findUnique({ where: { epicId: "EP-REFACTOR-001" } });
  await prisma.backlogItem.create({
    data: {
      itemId: item.itemId,
      title: item.title,
      type: item.type,
      // Tech debt is always filed open; a status copied through from another
      // record is what the unattributable-deferral guard refuses (BI-9DA5F179).
      status: "open",
      body: item.body,
      priority: item.priority,
      submittedById: userId,
      agentId: context?.agentId ?? null,
      ...(refactorEpic ? { epicId: refactorEpic.id } : {}),
    },
  });
  return { success: true, entityId: item.itemId, message: `Tech debt logged: ${item.itemId}` };
}

export const feedbackPack: ToolPack = {
  packId: "feedback",
  definitions,
  handlers: {
    report_quality_issue: (params, userId, context) => reportQualityIssue(params, userId, context),
    escalate_feedback_upstream: (params) => escalateFeedbackUpstream(params),
    register_tech_debt: (params, userId, context) => registerTechDebt(params, userId, context),
  },
  grants: {
    report_quality_issue: ["backlog_write"],
    escalate_feedback_upstream: ["backlog_write"],
    register_tech_debt: ["backlog_write"],
  },
};
