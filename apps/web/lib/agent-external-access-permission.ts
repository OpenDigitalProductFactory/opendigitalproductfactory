import { prisma } from "@dpf/db";
import type { ToolDefinition } from "@/lib/mcp-tools";

type AccessDecision = "request" | "approval";

const EXTERNAL_ACCESS_NEED_PATTERN =
  /\b(external access|public web|web search|website|https?:\/\/|www\.|url|official source|authority source|look up|find online|google|latest (news|guidance|rate|rule|version)|recent (news|guidance|change|update)|research (online|public|official|website|web))\b/i;

export function getExternalAccessToolSummaries(tools: ToolDefinition[]): Array<{
  name: string;
  description: string;
}> {
  const seen = new Set<string>();
  return tools
    .filter((tool) => tool.requiresExternalAccess)
    .filter((tool) => {
      if (seen.has(tool.name)) return false;
      seen.add(tool.name);
      return true;
    })
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));
}

export function shouldRequestExternalAccess(input: {
  content: string;
  taskRequiresWebSearch?: boolean;
  externalTools: Array<{ name: string }>;
}): boolean {
  if (input.externalTools.length === 0) return false;
  return input.taskRequiresWebSearch === true || EXTERNAL_ACCESS_NEED_PATTERN.test(input.content);
}

export type ExternalAccessDeniedReason =
  | "web-search-grant"
  | "no-web-search-grant"
  | "room-does-not-authorize-web";

/**
 * EP-WORK-POSTURE 8.2 (BI-947780FE): web access is no longer a switch the
 * employee flips. It follows from the coworker's standing grant and the
 * Workroom the turn runs in, so the instruction names the AUTHORITY that would
 * carry it, never a control in the composer.
 */
export function buildExternalAccessDisabledInstruction(
  tools: Array<{ name: string; description: string }>,
  context?: { externalAccess?: { reason?: ExternalAccessDeniedReason }; workroomId?: string | null },
): string {
  const toolList = tools.map((tool) => `- ${tool.name}: ${tool.description}`).join("\n");
  const reason = context?.externalAccess?.reason;
  const why =
    reason === "room-does-not-authorize-web"
      ? `This Workroom${context?.workroomId ? ` (${context.workroomId})` : ""} declares an activity that does not include public web research, so web tools are not available here.`
      : "This coworker does not hold web-research authority (the web_search grant), so public web tools are not available to it.";
  const remedy =
    reason === "room-does-not-authorize-web"
      ? "The room's accountable owner can widen the room's activity shape to include web research, or convene a review room whose shape carries it."
      : "A platform administrator can grant web research to this coworker under Platform > AI Coworkers, or route the request to a coworker whose role already carries it.";
  return [
    "",
    "",
    "--- EXTERNAL ACCESS NOT AUTHORIZED ---",
    "The employee request appears to need public web or official-source verification, but this turn is not authorized to reach the public web.",
    why,
    "Do not fabricate, do not imply that you checked public sources, and do not create a backlog item for this authority boundary.",
    `Tell the employee, in plain language, that the authority comes from the coworker's role and the Workroom, not from a switch. ${remedy}`,
    "Name the first public sources or search targets you would check once the authority is in place, and preserve the task context so the work can continue in this thread.",
    "Tools that would become available:",
    toolList,
  ].join("\n");
}

export async function recordExternalAccessPermissionAudit(input: {
  decision: AccessDecision;
  threadId: string;
  agentId: string;
  userId: string;
  routeContext: string;
  content: string;
  requestedTools: string[];
}) {
  const isApproval = input.decision === "approval";
  try {
    await prisma.toolExecution.create({
      data: {
        threadId: input.threadId,
        agentId: input.agentId,
        userId: input.userId,
        toolName: isApproval
          ? "external_access_permission_approval"
          : "external_access_permission_request",
        parameters: {
          requestedTools: input.requestedTools,
          routeContext: input.routeContext,
          userRequestPreview: input.content.slice(0, 500),
        },
        result: {
          decision: input.decision,
          status: isApproval ? "enabled_for_session" : "requested_from_user",
        },
        success: true,
        executionMode: "permission",
        routeContext: input.routeContext,
        durationMs: 0,
        auditClass: "ledger",
        capabilityId: "web_search",
        summary: isApproval
          ? `External Access enabled for ${input.requestedTools.join(", ")}`
          : `External Access requested for ${input.requestedTools.join(", ")}`,
      },
    });
  } catch (err) {
    console.warn("[external-access] permission audit failed:", err);
  }
}
