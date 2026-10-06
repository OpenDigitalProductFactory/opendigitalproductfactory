// Operator review of a dynamically discovered external MCP tool (BI-8B7B2FE9;
// plan 2026-08-30 Phase 5). The only path that moves a non-bundled tool to
// `approved`. Approval pins the exact text the reviewer saw: the caller sends
// the digest it displayed, and approval is refused if the row has moved on.
//
// Provenance is the canonical Principal (never a parallel identity), and every
// decision is written to AuthorizationDecisionLog in the same transaction.

import { randomUUID } from "node:crypto";
import { prisma, type McpToolEffect, type Prisma } from "@dpf/db";
import { knownGrantKeys } from "./agent-grants";
import {
  computeMcpToolContentDigest,
  isBundledMcpTool,
  MCP_TOOL_EFFECTS,
  MCP_TOOL_POLICY_VERSION,
  namespacedMcpToolName,
} from "./mcp-tool-policy";

export type McpToolReviewDecision = "approve" | "deny" | "return-to-review";

export type McpToolReviewInput = {
  toolId: string;
  decision: McpToolReviewDecision;
  /** Digest of the text the reviewer was shown (approve only). */
  reviewedContentDigest?: string;
  grantKey?: string;
  effect?: McpToolEffect;
  reason?: string;
};

export class McpToolReviewError extends Error {}

/** Modes follow from the effect: a read tool may advise and act; a tool that changes things only acts. */
export function modesForEffect(effect: McpToolEffect): ("advise" | "act")[] {
  return effect === "read_only" ? ["advise", "act"] : ["act"];
}

async function reviewerPrincipalId(tx: Prisma.TransactionClient, userId: string): Promise<string> {
  const alias = await tx.principalAlias.findFirst({
    where: { aliasType: "user", aliasValue: userId, issuer: "" },
    select: { principal: { select: { id: true, kind: true, status: true } } },
  });
  if (alias?.principal.kind !== "human" || alias.principal.status !== "active") {
    throw new McpToolReviewError("Your account has no active identity record, so it cannot review tools.");
  }
  return alias.principal.id;
}

export async function reviewMcpServerTool(userId: string, input: McpToolReviewInput): Promise<{ status: string }> {
  if (!input || typeof input.toolId !== "string" || !["approve", "deny", "return-to-review"].includes(input.decision)) {
    throw new McpToolReviewError("Choose a tool and a decision.");
  }
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 1000) : "";

  return prisma.$transaction(async (tx) => {
    const principalId = await reviewerPrincipalId(tx, userId);
    const tool = await tx.mcpServerTool.findUnique({
      where: { id: input.toolId },
      select: {
        id: true, toolName: true, description: true, inputSchema: true, policyStatus: true,
        approvedContentDigest: true, updatedAt: true,
        server: { select: { serverId: true } },
      },
    });
    if (!tool) throw new McpToolReviewError("That tool no longer exists.");
    const namespacedName = namespacedMcpToolName(tool.server.serverId, tool.toolName);
    const currentDigest = computeMcpToolContentDigest(tool.description, tool.inputSchema);
    const now = new Date();

    let data: Prisma.McpServerToolUncheckedUpdateManyInput;
    let rationale: Record<string, unknown>;
    if (input.decision === "approve") {
      if (isBundledMcpTool(namespacedName)) {
        throw new McpToolReviewError("This tool ships with the platform; its access is set by the release.");
      }
      if (!input.reviewedContentDigest || input.reviewedContentDigest !== currentDigest) {
        throw new McpToolReviewError("The service changed this tool while you were reviewing it. Reload and review the new text.");
      }
      if (!input.grantKey || !knownGrantKeys().includes(input.grantKey)) {
        throw new McpToolReviewError("Choose the permission a coworker must hold to use this tool.");
      }
      if (!input.effect || !(MCP_TOOL_EFFECTS as readonly string[]).includes(input.effect)) {
        throw new McpToolReviewError("Say whether this tool only reads or also changes things.");
      }
      const modes = modesForEffect(input.effect);
      data = {
        policyStatus: "approved",
        policyEffect: input.effect,
        policyExecutionModes: modes,
        policyGrantKey: input.grantKey,
        policyVersion: MCP_TOOL_POLICY_VERSION,
        approvedToolIdentity: namespacedName,
        approvedContentDigest: currentDigest,
        approvedDescription: tool.description,
        approvedInputSchema: tool.inputSchema as Prisma.InputJsonValue,
        approvedByPrincipalId: principalId,
        approvedAt: now,
        policyChangedAt: now,
      };
      rationale = {
        decision: "approve", grantKey: input.grantKey, effect: input.effect, modes,
        contentDigest: currentDigest, previousApprovedDigest: tool.approvedContentDigest, reason,
      };
    } else {
      data = {
        policyStatus: input.decision === "deny" ? "denied" : "quarantined",
        policyChangedAt: now,
      };
      rationale = { decision: input.decision, previousStatus: tool.policyStatus, contentDigest: currentDigest, reason };
    }

    // Compare-and-set on updatedAt: a concurrent rediscovery or review wins and this one retries.
    const saved = await tx.mcpServerTool.updateMany({
      where: { id: tool.id, updatedAt: tool.updatedAt },
      data,
    });
    if (saved.count !== 1) throw new McpToolReviewError("This tool changed while you were reviewing it. Reload and try again.");

    await tx.authorizationDecisionLog.create({
      data: {
        decisionId: `ADL-${randomUUID()}`,
        actorType: "human",
        actorRef: userId,
        humanContextRef: userId,
        purposeOfUse: "mcp-tool-policy-review",
        policyVersion: `discovered-mcp-tool-policy.v${MCP_TOOL_POLICY_VERSION}`,
        actionKey: "mcp-tool-policy-review",
        objectRef: namespacedName,
        decision: input.decision === "approve" ? "allow" : "deny",
        rationale: { ...rationale, principalId } as Prisma.InputJsonValue,
        routeContext: "/platform/tools/services",
      },
    });
    return { status: String(data.policyStatus) };
  });
}
