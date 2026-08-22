import {
  completeWorkCapsuleTransition,
  type GovernedTerminalTransitionResult,
} from "@/lib/backlog/initiative-readiness";

import type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";

export class WorkCapsuleCompletionDeniedError extends Error {
  readonly result: Extract<GovernedTerminalTransitionResult, { ok: false }>;

  constructor(result: Extract<GovernedTerminalTransitionResult, { ok: false }>) {
    super(`Work Capsule completion denied: ${result.code}`);
    this.name = "WorkCapsuleCompletionDeniedError";
    this.result = result;
  }
}

/** Preserve the store contract while the central repository owns completion. */
export async function completeGovernedWorkCapsuleStatus(args: {
  db: CapsuleDb;
  capsuleId: string;
  expectedStatus: string;
  reason: string;
  actor: WorkCapsuleActor;
  evaluatedAt: string;
}) {
  const result = await completeWorkCapsuleTransition({
    db: args.db as never,
    capsuleId: args.capsuleId,
    expectedStatus: args.expectedStatus,
    reason: args.reason,
    actor: args.actor,
    evaluatedAt: args.evaluatedAt,
  });
  if (!result.ok) throw new WorkCapsuleCompletionDeniedError(result);
  const completed = await args.db.workroom.findUnique({ where: { capsuleId: args.capsuleId } });
  if (!completed) throw new Error(`Work Capsule ${args.capsuleId} disappeared after completion`);
  return completed;
}
