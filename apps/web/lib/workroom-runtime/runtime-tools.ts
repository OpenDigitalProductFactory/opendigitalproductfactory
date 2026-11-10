// MCP handlers for the Workroom runtime (BI-05715F4C): drive_workroom_runtime
// and approve_runtime_permission, over one supervisor per portal process.

import { prisma } from "@dpf/db";
import type { ToolResult } from "@/lib/mcp-tool-types";
import { issueWorkroomSessionToken, revokeWorkroomSessionTokens } from "@/lib/auth/workroom-session-token";
import { resolveCodexCatalogAuth } from "@/lib/inference/codex-cli-catalog-auth";
import { resolveCliAuth } from "@/lib/routing/cli-adapter";
import { workCapsuleActor } from "@/lib/work-capsules/handler-actor";

import { createClaudeAdapter } from "./claude-stream-adapter";
import { createCodexAdapter } from "./codex-app-server-adapter";
import { sandboxRuntimeLauncher } from "./sandbox-launcher";
import { createRuntimeSupervisor, type RuntimeSupervisor } from "./supervisor";
import type { RuntimeDecision, RuntimeProvider } from "./types";

type ToolContext = { agentId?: string; authSource?: string; apiTokenId?: string } | undefined;

const MCP_URL = `${process.env.DPF_INTERNAL_PORTAL_URL ?? "http://portal:3000"}/api/mcp/v1`;
const ACTIONS = ["start", "turn", "steer", "interrupt", "stop", "decide", "status"] as const;
const PROVIDERS: readonly RuntimeProvider[] = ["codex", "claude"];
const DECISIONS: readonly RuntimeDecision[] = ["accept", "decline", "cancel"];

// One supervisor per process; kept on globalThis so a dev reload does not orphan live sessions.
const globalRuntime = globalThis as typeof globalThis & { __dpfWorkroomRuntime?: RuntimeSupervisor };

export function workroomRuntimeSupervisor(): RuntimeSupervisor {
  globalRuntime.__dpfWorkroomRuntime ??= createRuntimeSupervisor({
    mcpUrl: MCP_URL,
    adapters: {
      codex: createCodexAdapter({ launch: sandboxRuntimeLauncher, login: () => resolveCodexCatalogAuth("codex") }),
      claude: createClaudeAdapter({ launch: sandboxRuntimeLauncher, auth: () => resolveCliAuth("anthropic-sub") }),
    },
    issueToken: issueWorkroomSessionToken,
    revokeTokens: revokeWorkroomSessionTokens,
  });
  return globalRuntime.__dpfWorkroomRuntime;
}

const str = (params: Record<string, unknown>, key: string) => (typeof params[key] === "string" ? (params[key] as string).trim() : "");

export async function driveWorkroomRuntimeTool(params: Record<string, unknown>, userId: string, context: ToolContext): Promise<ToolResult> {
  const capsuleId = str(params, "capsuleId");
  const action = str(params, "action") as (typeof ACTIONS)[number];
  if (!capsuleId || !ACTIONS.includes(action)) {
    return { success: false, error: "invalid_input", message: `capsuleId and action (${ACTIONS.join(", ")}) are required.` };
  }
  const runtime = workroomRuntimeSupervisor();
  const actor = await workCapsuleActor(userId, context);
  const prompt = str(params, "prompt");
  switch (action) {
    case "start": {
      const provider = str(params, "provider") as RuntimeProvider;
      if (!PROVIDERS.includes(provider)) return { success: false, error: "invalid_input", message: "provider must be codex or claude." };
      return runtime.start({ capsuleId, provider, actor, prompt, model: str(params, "model") || null, ...(str(params, "cwd") ? { cwd: str(params, "cwd") } : {}) });
    }
    case "turn":
    case "steer":
      if (!prompt) return { success: false, error: "invalid_input", message: "prompt is required." };
      return runtime.turn({ capsuleId, prompt, steer: action === "steer" });
    case "interrupt":
      return runtime.interrupt(capsuleId);
    case "stop":
      return runtime.stop({ capsuleId, reason: str(params, "reason") || "stopped by the room", actor });
    case "decide": {
      const decision = str(params, "decision") as RuntimeDecision;
      const requestId = str(params, "requestId");
      if (!requestId || !DECISIONS.includes(decision)) {
        return { success: false, error: "invalid_input", message: "requestId and decision (accept, decline, cancel) are required." };
      }
      return runtime.decide({ capsuleId, requestId, decision, reason: str(params, "reason") || "decided on the room", actor });
    }
    case "status":
      return { success: true, message: `Runtime status for ${capsuleId}.`, data: runtime.status(capsuleId) };
  }
}

/**
 * Claude Code's --permission-prompt-tool. The room comes from the calling
 * credential, never from the request: only a room session token can ask.
 */
export async function approveRuntimePermissionTool(params: Record<string, unknown>, _userId: string, context: ToolContext): Promise<ToolResult> {
  const deny = (message: string): ToolResult => ({ success: true, message, data: { behavior: "deny", message } });
  const tokenId = context?.apiTokenId;
  const token = tokenId
    ? await prisma.mcpApiToken.findUnique({ where: { id: tokenId }, select: { kind: true, workroomRef: true, revokedAt: true } })
    : null;
  if (!token?.workroomRef || token.kind !== "workroom_session" || token.revokedAt) {
    return deny("Only a Workroom runtime session can ask for runtime permission.");
  }
  const toolName = str(params, "tool_name");
  const toolInput = params["input"] && typeof params["input"] === "object" && !Array.isArray(params["input"])
    ? params["input"] as Record<string, unknown> : {};
  if (!toolName) return deny("tool_name is required.");
  const answer = await workroomRuntimeSupervisor().claudePermission({ capsuleId: token.workroomRef, toolName, toolInput });
  return { success: true, message: answer.behavior === "allow" ? `Allowed ${toolName}.` : answer.message, data: answer };
}
