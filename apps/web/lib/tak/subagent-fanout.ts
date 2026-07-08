// Coworker subagent fan-out primitive — BI-E63B8293 (EP-CLAUDE-INSIDE-OUT).
//
// The external Claude harness Agent/Workflow tools spawn N parallel subagents
// from one turn. DPF had governed delegation chains (delegation-authority.ts) and
// TaskRun records but no lightweight "spawn N governed sub-tasks at once"
// primitive. This wraps the existing governance: each subtask is a delegation
// from the calling coworker to a target coworker (startChain — loop-safe,
// authority-propagating, depth-limited), and, when allowed, a child TaskRun is
// created (parentTaskRunId set) that rides the existing TaskRun dispatch.
//
// Runaway guard: the fan-out width is hard-capped (MAX_FANOUT_WIDTH); excess
// subtasks are dropped and reported, never silently truncated.

import { randomUUID } from "node:crypto";

import { prisma } from "@dpf/db";

import { startChain } from "./delegation-authority";

/** Hard ceiling on how many subagents one call may spawn. */
export const MAX_FANOUT_WIDTH = 8;

export type SubtaskSpec = {
  /** What the spawned subagent should accomplish. */
  objective: string;
  /** Target coworker Agent.id (cuid) the work is delegated to. */
  toAgentId: string;
  /** Short human title; falls back to a truncated objective. */
  title?: string;
};

export type SpawnedSubagent =
  | { ok: true; taskRunId: string; toAgentId: string; chainId: string }
  | { ok: false; toAgentId: string; reason: string };

export type FanoutResult = {
  spawned: SpawnedSubagent[];
  /** Subtasks beyond MAX_FANOUT_WIDTH that were not attempted. */
  dropped: SubtaskSpec[];
};

/**
 * Pure: split a requested subtask list into the accepted head (<= max) and the
 * dropped tail. Keeps the runaway guard testable and makes truncation explicit.
 */
export function capFanoutWidth<T>(requested: readonly T[], max: number = MAX_FANOUT_WIDTH): { accepted: T[]; dropped: T[] } {
  if (requested.length <= max) return { accepted: [...requested], dropped: [] };
  return { accepted: requested.slice(0, max), dropped: requested.slice(max) };
}

/**
 * Spawn a governed fan-out of subagents from `parentAgentId`. Each accepted
 * subtask is delegated via startChain (self-delegation and over-broad authority
 * are rejected there); on approval a child TaskRun is created and linked to the
 * parent run. Per-item failures are isolated — one blocked delegation never
 * aborts the others. Width is capped; the overflow is returned in `dropped`.
 */
export async function spawnSubagentFanout(input: {
  parentAgentId: string;
  parentTaskRunId?: string | null;
  userId: string;
  originAuthority: string[];
  subtasks: SubtaskSpec[];
}): Promise<FanoutResult> {
  const { accepted, dropped } = capFanoutWidth(input.subtasks);
  const spawned: SpawnedSubagent[] = [];

  for (const sub of accepted) {
    const objective = (sub.objective ?? "").trim();
    if (!objective) {
      spawned.push({ ok: false, toAgentId: sub.toAgentId, reason: "Empty objective." });
      continue;
    }

    const delegation = await startChain(input.parentAgentId, sub.toAgentId, null, input.userId, input.originAuthority);
    if (!delegation.allowed || !delegation.link) {
      spawned.push({ ok: false, toAgentId: sub.toAgentId, reason: delegation.reason });
      continue;
    }

    const child = await prisma.taskRun.create({
      data: {
        taskRunId: `fanout-${randomUUID()}`,
        userId: input.userId,
        parentTaskRunId: input.parentTaskRunId ?? null,
        initiatingAgentId: input.parentAgentId,
        currentAgentId: sub.toAgentId,
        title: (sub.title ?? objective).slice(0, 120),
        objective,
        source: "coworker",
        status: "submitted",
        authorityScope: delegation.propagatedAuthority,
        a2aMetadata: { fanout: true, chainId: delegation.link.chainId, delegationLinkId: delegation.link.id },
      },
      select: { taskRunId: true },
    });

    spawned.push({ ok: true, taskRunId: child.taskRunId, toAgentId: sub.toAgentId, chainId: delegation.link.chainId });
  }

  return { spawned, dropped };
}
