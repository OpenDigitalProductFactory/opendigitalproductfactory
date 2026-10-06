// Governed-executor admission for dynamically discovered external MCP tools
// (BI-8B7B2FE9; plan 2026-08-30 Phase 4). The governed executor knows platform
// tools from PLATFORM_TOOLS; a namespaced `<server>__<tool>` name is resolved
// here, from the database, at call time — never from the list the model saw.
//
// Scope is deliberately narrow: only in-portal coworker turns (`agentic-loop`)
// with an acting agent may reach a discovered tool. Every other source (REST,
// JSON-RPC, internal MCP session) keeps the prior `unknown_tool` answer, so
// this change cannot widen the external-client surface.

import { randomUUID } from "node:crypto";
import { prisma } from "@dpf/db";
import type { ToolDefinition } from "@/lib/mcp-tool-types";
import type { GovernedExecuteArgs } from "@/lib/mcp-governed-execute-types";
import { sanitizeForLog } from "@/lib/security/safe-log";
import { parseNamespacedTool, resolveDiscoveredToolForCall } from "./mcp-server-tools";
import { evaluateDiscoveredToolAccess, type ResolvedDiscoveredToolPolicy } from "./mcp-tool-policy";

export type GovernedDiscoveredTool =
  | { kind: "not-discovered" }
  | { kind: "refused"; reason: string }
  | { kind: "resolved"; tool: ToolDefinition; policy: ResolvedDiscoveredToolPolicy };

let decisionWriter: ((row: Record<string, unknown>) => Promise<void>) | null = null;

/** Test seam: capture AuthorizationDecisionLog rows instead of writing them. */
export function _setDiscoveredDecisionWriterForTests(writer: typeof decisionWriter): void {
  decisionWriter = writer;
}

async function recordPolicyRefusal(args: GovernedExecuteArgs, reason: string): Promise<void> {
  const row = {
    decisionId: `AUTH-${randomUUID()}`,
    actorType: "ai-coworker",
    actorRef: args.context?.agentId ?? "unknown",
    humanContextRef: args.userId,
    agentContextRef: args.context?.agentId ?? null,
    purposeOfUse: "tool-execution",
    policyVersion: "discovered-mcp-tool-policy",
    actionKey: args.toolName,
    objectRef: null,
    decision: "deny",
    rationale: { reasonCode: `discovered-tool-${reason}`, nextAction: "request-tool-review" },
    endpointUsed: args.source,
    routeContext: args.context?.routeContext ?? null,
  };
  try {
    if (decisionWriter) await decisionWriter(row);
    else await prisma.authorizationDecisionLog.create({ data: row });
  } catch (error) {
    console.error(
      "[discovered-tool-governance] decision write failed tool=%s: %s",
      sanitizeForLog(args.toolName),
      sanitizeForLog(error instanceof Error ? error.message : String(error)),
    );
  }
}

/**
 * Resolve a namespaced discovered tool for one governed call. A refusal is
 * recorded in AuthorizationDecisionLog; an admitted tool continues through the
 * ordinary authority gate, which records its own allow/deny.
 */
export async function resolveGovernedDiscoveredTool(args: GovernedExecuteArgs): Promise<GovernedDiscoveredTool> {
  if (!parseNamespacedTool(args.toolName)) return { kind: "not-discovered" };
  if (args.source !== "agentic-loop" || !args.context?.agentId) {
    return { kind: "refused", reason: "unknown-tool" };
  }
  const resolved = await resolveDiscoveredToolForCall(args.toolName);
  if (!resolved.resolved) {
    await recordPolicyRefusal(args, resolved.reason);
    return { kind: "refused", reason: resolved.reason };
  }
  return { kind: "resolved", tool: resolved.definition as ToolDefinition, policy: resolved.policy };
}

/** The coworker-grant half of the decision, fed to the authority gate as agentGrantAllowed. */
export function discoveredToolGrantAllowed(
  policy: ResolvedDiscoveredToolPolicy,
  grants: readonly string[],
  args: GovernedExecuteArgs,
): boolean {
  return evaluateDiscoveredToolAccess(policy, {
    agentGrants: grants,
    roomAuthorizedGrants: args.context?.roomAuthority?.authorizedGrants ?? null,
    externalAccessEnabled: args.context?.externalAccessEnabled === true,
    mode: "act",
  }).allowed;
}

/**
 * Governed-executor entry: a platform tool passes through unchanged; otherwise a
 * namespaced discovered tool is admitted from DPF-owned policy at call time,
 * never from the list the model saw. Neither → tool undefined (unknown_tool).
 */
export async function resolveGovernedTool(
  args: GovernedExecuteArgs,
  platformTool: ToolDefinition | undefined,
): Promise<{ tool: ToolDefinition | undefined; discovered: { tool: ToolDefinition; policy: ResolvedDiscoveredToolPolicy } | null }> {
  if (platformTool) return { tool: platformTool, discovered: null };
  const admission = await resolveGovernedDiscoveredTool(args);
  return admission.kind === "resolved"
    ? { tool: admission.tool, discovered: { tool: admission.tool, policy: admission.policy } }
    : { tool: undefined, discovered: null };
}

/** The authorization the remote-call recheck must still match, carried in the execution context. */
export function discoveredToolExecutionContext(
  discovered: { policy: ResolvedDiscoveredToolPolicy } | null,
): { discoveredToolAuthorization?: { namespacedName: string; contentDigest: string } } {
  return discovered
    ? { discoveredToolAuthorization: { namespacedName: discovered.policy.namespacedName, contentDigest: discovered.policy.contentDigest } }
    : {};
}
