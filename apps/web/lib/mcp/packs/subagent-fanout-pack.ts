// Subagent fan-out pack — BI-E63B8293 (EP-CLAUDE-INSIDE-OUT).
//
// One gated door, spawn_subagents: the calling coworker spawns up to
// MAX_FANOUT_WIDTH governed child sub-tasks in one call, each delegated to a
// named target coworker via the existing delegation-authority chain (loop-safe,
// authority-propagating, depth-limited) and materialized as a child TaskRun.
//
// Gated on coworker_engagement_write — spawning work for other coworkers is a
// real authority action, unlike the self-scoped memory/goal doors. The parent is
// resolved from context.agentId; targets are resolved coworkers.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";
import { MAX_FANOUT_WIDTH } from "@/lib/tak/subagent-fanout";

const definitions: ToolDefinition[] = [
  {
    name: "spawn_subagents",
    description:
      `Spawn up to ${MAX_FANOUT_WIDTH} parallel governed sub-tasks in one call, each delegated to a named coworker. Use to fan work out — one target coworker and one objective per subtask. Each spawned sub-task is a governed delegation (loop-safe, authority-narrowing) and becomes a child task that runs independently. Returns the spawned task ids and any that were refused (self-delegation, depth, or authority) or dropped past the width cap.`,
    inputSchema: {
      type: "object",
      properties: {
        subtasks: {
          type: "array",
          description: "The sub-tasks to spawn (each delegated to one coworker).",
          items: {
            type: "object",
            properties: {
              objective: { type: "string", description: "What the spawned sub-task should accomplish." },
              toCoworker: { type: "string", description: "The target coworker (agentId, slug, or name) to delegate to." },
              title: { type: "string", description: "Optional short title for the sub-task." },
            },
            required: ["objective", "toCoworker"],
          },
        },
      },
      required: ["subtasks"],
    },
    requiredCapability: null,
    sideEffect: true,
  },
];

type RawSubtask = { objective?: unknown; toCoworker?: unknown; title?: unknown };

async function spawnSubagentsHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const { resolveCoworkerAgent } = await import("@/lib/tak/coworker-tool-grant-core");
  const parent = context?.agentId ? await resolveCoworkerAgent(context.agentId) : null;
  if (!parent) {
    return { success: false, error: "no_calling_coworker", message: "Only a coworker can spawn sub-tasks." };
  }

  const raw = Array.isArray(params["subtasks"]) ? (params["subtasks"] as RawSubtask[]) : [];
  if (raw.length === 0) {
    return { success: false, error: "no_subtasks", message: "Provide at least one subtask with an objective and toCoworker." };
  }

  // Resolve each target coworker to a cuid; unresolved targets fail that item only.
  const resolved: Array<{ objective: string; toAgentId: string; title?: string } | { error: string }> = [];
  for (const s of raw) {
    const objective = String(s.objective ?? "").trim();
    const ref = String(s.toCoworker ?? "").trim();
    const target = ref ? await resolveCoworkerAgent(ref) : null;
    if (!target) resolved.push({ error: `No coworker matches "${ref}".` });
    else resolved.push({ objective, toAgentId: target.id, title: s.title != null ? String(s.title) : undefined });
  }

  const spawnable = resolved.filter((r): r is { objective: string; toAgentId: string; title?: string } => !("error" in r));
  const unresolved = resolved.filter((r): r is { error: string } => "error" in r);

  // The calling coworker's grant keys are the authority propagated to children.
  const { prisma } = await import("@dpf/db");
  const parentGrants = await prisma.agentToolGrant.findMany({ where: { agentId: parent.id }, select: { grantKey: true } });
  const originAuthority = parentGrants.map((g) => g.grantKey);

  const { spawnSubagentFanout } = await import("@/lib/tak/subagent-fanout");
  const result = await spawnSubagentFanout({
    parentAgentId: parent.agentId,
    userId,
    originAuthority,
    subtasks: spawnable,
  });

  const spawned = result.spawned.filter((s) => s.ok);
  return {
    success: true,
    message: `Spawned ${spawned.length} sub-task(s)` +
      (result.dropped.length ? `; dropped ${result.dropped.length} over the width cap` : "") +
      (unresolved.length ? `; ${unresolved.length} target(s) unresolved` : "") + ".",
    data: {
      spawned: spawned.map((s) => (s.ok ? { taskRunId: s.taskRunId, toAgentId: s.toAgentId } : null)).filter(Boolean),
      refused: result.spawned.filter((s) => !s.ok),
      droppedCount: result.dropped.length,
      unresolved: unresolved.map((u) => u.error),
    },
  };
}

export const subagentFanoutPack: ToolPack = {
  packId: "subagent-fanout",
  definitions,
  handlers: {
    spawn_subagents: (params, userId, context) => spawnSubagentsHandler(params, userId, context),
  },
  grants: {
    spawn_subagents: ["coworker_engagement_write"],
  },
};
