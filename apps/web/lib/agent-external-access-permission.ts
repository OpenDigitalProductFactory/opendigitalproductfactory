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

export function buildExternalAccessDisabledInstruction(
  tools: Array<{ name: string; description: string }>,
): string {
  const toolList = tools.map((tool) => `- ${tool.name}: ${tool.description}`).join("\n");
  return [
    "",
    "",
    "--- EXTERNAL ACCESS DISABLED ---",
    "The employee's request appears to need public web or official-source verification, but External Access is off for this page and session.",
    "Do not fabricate, do not imply that you checked public sources, and do not create a backlog item for this permission boundary.",
    "Instead, ask the employee to enable External Access, explain why it is needed in plain language, and name the first public sources or search targets you will check.",
    "Preserve the task context so the employee can enable External Access and continue in this thread.",
    "Tools that become available after enablement:",
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
