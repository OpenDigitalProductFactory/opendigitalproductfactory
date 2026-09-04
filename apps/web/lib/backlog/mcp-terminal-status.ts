import type { ToolResult } from "@/lib/mcp-tools";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { resolveTerminalInitiativeRecovery } from "@/lib/backlog/initiative-readiness/terminal-recovery";

type TerminalBacklogItem = {
  status: string;
  epicId: string | null;
  organizationId: string | null;
};

/** MCP adapter for the canonical backlog transition and dependent Epic close. */
export async function completeBacklogItemTransitionTool(args: {
  item: TerminalBacklogItem;
  itemId: string;
  resolution: string;
  completionEvidence: unknown;
  userId: string;
  agentId?: string;
}): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const { completeBacklogItemTransition } = await import(
    "@/lib/backlog/initiative-readiness/backlog-terminal-transition"
  );
  const organizationId = args.item.organizationId ?? "platform";
  const actor = {
    actorType: args.agentId ? "agent" as const : "human" as const,
    actorRef: args.agentId ?? args.userId,
    humanContextRef: args.userId,
    agentContextRef: args.agentId ?? null,
  };
  const terminal = await completeBacklogItemTransition({
    itemId: args.itemId,
    expectedStatus: args.item.status,
    resolution: args.resolution,
    completionEvidence: args.completionEvidence,
    actor,
    authority: {
      organizationId: args.item.organizationId,
      actionKey: "update_backlog_item_status",
      objectRef: args.itemId,
      rationale: { capability: "manage_backlog", grant: "backlog_write", source: "governed-mcp" },
      authoritySnapshot: {
        decision: "allow",
        effectiveHumanCapability: "manage_backlog",
        effectiveAgentGrant: "backlog_write",
        tokenScope: "organization",
        organizationId,
        actionKey: "update_backlog_item_status",
        policyVersion: "coworker-authority.v1",
      },
    },
  });
  if (!terminal.ok) {
    const codes = [...terminal.decision.blockers, ...terminal.decision.unmet].map((entry) => entry.code);
    const recovery = await resolveTerminalInitiativeRecovery({
      decision: terminal.decision,
      currentAgentId: args.agentId ?? null,
      refusedWorkroomId: null,
    });
    return {
      success: false,
      error: "initiative_not_ready",
      message: `Cannot complete ${args.itemId}: ${codes.join(", ")}.`,
      data: { stableCode: terminal.code, readiness: terminal.decision, recovery },
    };
  }

  if (args.item.epicId) {
    const remaining = await prisma.backlogItem.count({
      where: { epicId: args.item.epicId, status: { notIn: ["done", "retired"] } },
    });
    const epic = remaining === 0
      ? await prisma.epic.findUnique({ where: { id: args.item.epicId }, select: { epicId: true, status: true } })
      : null;
    if (epic && epic.status !== "done") {
      const { completeEpicTransition } = await import(
        "@/lib/backlog/initiative-readiness/epic-terminal-transition"
      );
      await completeEpicTransition({
        epicId: epic.epicId,
        expectedStatus: epic.status,
        actor,
        authority: {
          organizationId: args.item.organizationId,
          actionKey: "auto_close_epic",
          objectRef: epic.epicId,
          rationale: { capability: "manage_backlog", grant: "backlog_write", source: "backlog-child-terminal" },
          authoritySnapshot: {
            decision: "allow",
            effectiveHumanCapability: "manage_backlog",
            effectiveAgentGrant: "backlog_write",
            tokenScope: "organization",
            organizationId,
            actionKey: "auto_close_epic",
            policyVersion: "coworker-authority.v1",
          },
        },
      });
    }
  }

  void (async () => {
    try {
      const { bridgeBacklogItemToWorkItem } = await import("@/lib/queue/bridges/backlog-bridge");
      await bridgeBacklogItemToWorkItem(args.itemId);
    } catch (error) {
      console.warn(`[cwq-bridge] failed to bridge ${args.itemId} to a work item: ${getErrorMessage(error)}`);
    }
  })();
  return {
    success: true,
    entityId: args.itemId,
    message: `${args.itemId}: ${args.item.status} → done`,
    data: { itemId: args.itemId, status: "done", readiness: terminal.decision },
  };
}
