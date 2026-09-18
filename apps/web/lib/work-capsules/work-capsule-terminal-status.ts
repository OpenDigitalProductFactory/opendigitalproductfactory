import {
  completeWorkCapsuleTransition,
  type GovernedTerminalTransitionResult,
} from "@/lib/backlog/initiative-readiness";

import type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";

/**
 * A review-bound status (ready-for-review, ready-for-promotion, complete) was
 * refused by the failure-readiness boundary. Distinct from a completion denial:
 * it carries a closed refusal code so the MCP surface can answer with the
 * repair step instead of an opaque throw (BI-023EF164).
 */
export class WorkCapsulePublicationRefusedError extends Error {
  readonly code: "workroom_identity_incomplete" | "failure_review_required";
  readonly reason: string;

  constructor(input: { code: WorkCapsulePublicationRefusedError["code"]; reason: string }) {
    super(input.reason);
    this.name = "WorkCapsulePublicationRefusedError";
    this.code = input.code;
    this.reason = input.reason;
  }
}

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
