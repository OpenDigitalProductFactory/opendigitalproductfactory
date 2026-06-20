// apps/web/lib/tak/execution-plan-store.ts
//
// Crash-durable persistence for the agentic-loop ExecutionPlan (BI-655507BA).
//
// execution-plan.ts is PURE (the plan artifact + its mutators). The loop holds
// one plan in memory and re-renders it each turn so it survives *compaction* —
// but a process restart wipes it. This module persists the plan to its
// AgentThread (write-through on each mutation, reload on loop resume) so it also
// survives a *process restart*, mirroring how the build pipeline journals steps.
//
// All DB I/O lives here, never in execution-plan.ts — the loop is the only
// orchestrator that calls both. Persistence is best-effort: it NEVER throws, so
// a DB hiccup can't corrupt the loop.

import { prisma, Prisma } from "@dpf/db";
import type { ExecutionPlan, ExecutionPlanStepStatus } from "./execution-plan";

const VALID_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "in_progress",
  "done",
  "skipped",
]);

/**
 * Validate stored JSON into an ExecutionPlan. Pure. Returns null on ANY
 * malformation — a column written by an older/buggy build must never crash the
 * resumed loop; on doubt the model simply re-plans.
 */
export function parseStoredExecutionPlan(raw: unknown): ExecutionPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.goal !== "string") return null;
  if (!Array.isArray(o.steps)) return null;
  const steps: ExecutionPlan["steps"] = [];
  for (const s of o.steps) {
    if (!s || typeof s !== "object") return null;
    const so = s as Record<string, unknown>;
    if (typeof so.id !== "string" || typeof so.description !== "string") return null;
    if (typeof so.status !== "string" || !VALID_STATUSES.has(so.status)) return null;
    steps.push({
      id: so.id,
      description: so.description,
      status: so.status as ExecutionPlanStepStatus,
    });
  }
  const createdAtIteration = typeof o.createdAtIteration === "number" ? o.createdAtIteration : 0;
  const updatedAtIteration =
    typeof o.updatedAtIteration === "number" ? o.updatedAtIteration : createdAtIteration;
  return { goal: o.goal, steps, createdAtIteration, updatedAtIteration };
}

function warn(action: string, threadId: string, err: unknown): void {
  // eslint-disable-next-line no-console
  console.warn(
    "[execution-plan] %s failed for %s: %s",
    action,
    JSON.stringify(threadId),
    err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
  );
}

/** Best-effort write-through of the loop's ExecutionPlan to its AgentThread. Never throws. */
export async function persistExecutionPlan(
  threadId: string,
  plan: ExecutionPlan | null,
): Promise<void> {
  try {
    await prisma.agentThread.update({
      where: { id: threadId },
      data: {
        executionPlan: plan
          ? (JSON.parse(JSON.stringify(plan)) as Prisma.InputJsonValue)
          : Prisma.DbNull,
      },
    });
  } catch (err) {
    warn("persist", threadId, err);
  }
}

/** Best-effort reload of a persisted ExecutionPlan for a thread. Null on miss/error/garbage. */
export async function loadExecutionPlan(threadId: string): Promise<ExecutionPlan | null> {
  try {
    const row = await prisma.agentThread.findUnique({
      where: { id: threadId },
      select: { executionPlan: true },
    });
    return parseStoredExecutionPlan(row?.executionPlan ?? null);
  } catch (err) {
    warn("load", threadId, err);
    return null;
  }
}
