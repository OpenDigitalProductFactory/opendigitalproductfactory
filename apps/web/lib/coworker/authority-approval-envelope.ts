import "server-only";

import { prisma } from "@dpf/db";

import {
  fingerprintCoworkerApprovalBinding,
  type CoworkerApprovalBinding,
} from "@/lib/govern/authority/coworker-authority-decision";
import { markTaskRunWorking } from "@/lib/observability/heartbeat";

export const AUTHORITY_APPROVAL_TTL_MS = 15 * 60 * 1000;

type EnvelopeSummary = {
  id: string;
  status: string;
  expiresAt: Date | null;
  argsJson?: unknown;
};

type AuthorityApprovalDb = {
  coworkerActionEnvelope: {
    findFirst(args: unknown): Promise<EnvelopeSummary | null>;
    create(args: unknown): Promise<EnvelopeSummary>;
    updateMany(args: unknown): Promise<unknown>;
  };
  taskRun: { updateMany(args: unknown): Promise<unknown> };
};

type MarkTaskWorking = (taskRunId: string) => Promise<void>;

function activeEnvelopeWhere(
  approvalBindingFingerprint: string,
  now: Date,
) {
  return {
    approvalBindingFingerprint,
    status: { in: ["proposed", "approved"] },
    expiresAt: { gt: now },
  };
}

async function findActiveEnvelope(
  approvalBindingFingerprint: string,
  now: Date,
  db: AuthorityApprovalDb,
): Promise<EnvelopeSummary | null> {
  return db.coworkerActionEnvelope.findFirst({
    where: activeEnvelopeWhere(approvalBindingFingerprint, now),
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, expiresAt: true, argsJson: true },
  });
}

async function pauseBoundTask(
  taskRunId: string | null,
  db: AuthorityApprovalDb,
): Promise<void> {
  if (!taskRunId) return;
  await db.taskRun.updateMany({
    where: {
      taskRunId,
      status: { in: ["submitted", "working"] },
    },
    data: { status: "input-required" },
  });
}

export async function ensureAuthorityApprovalEnvelope(
  input: {
    binding: CoworkerApprovalBinding;
    authorityDecisionId: string;
    threadId: string | null;
    explanation: string;
    now?: Date;
  },
  db: AuthorityApprovalDb = prisma as unknown as AuthorityApprovalDb,
): Promise<EnvelopeSummary> {
  const now = input.now ?? new Date();
  const approvalBindingFingerprint =
    fingerprintCoworkerApprovalBinding(input.binding);

  // Free the active-binding uniqueness slot when an abandoned proposal has
  // expired. This is a legal proposed|approved -> cancelled transition.
  await db.coworkerActionEnvelope.updateMany({
    where: {
      approvalBindingFingerprint,
      status: { in: ["proposed", "approved"] },
      expiresAt: { lte: now },
    },
    data: { status: "cancelled", resolvedAt: now },
  });

  const existing = await findActiveEnvelope(
    approvalBindingFingerprint,
    now,
    db,
  );
  if (existing) {
    await pauseBoundTask(input.binding.taskRunId, db);
    return existing;
  }

  const expiresAt = new Date(now.getTime() + AUTHORITY_APPROVAL_TTL_MS);
  let created: EnvelopeSummary;
  try {
    created = await db.coworkerActionEnvelope.create({
      data: {
        coworkerAgentId: input.binding.actingAgentId,
        delegatingUserId: input.binding.actingHumanUserId,
        threadId:
          input.threadId
          ?? (input.binding.taskRunId
            ? `task:${input.binding.taskRunId}`
            : `authority:${input.binding.actingAgentId}`),
        manifestActionId: input.binding.toolName,
        // Never persist raw tool arguments in the universal authority
        // envelope. The exact-call fingerprint and bounded binding are enough
        // to prove what the human approved.
        argsJson: { approvalBinding: input.binding },
        rationale: input.explanation,
        taskRunId: input.binding.taskRunId,
        delegationChainId: input.binding.chainId,
        authorityDecisionId: input.authorityDecisionId,
        inputFingerprint: input.binding.inputFingerprint,
        approvalBindingFingerprint,
        expiresAt,
      },
    });
  } catch (err) {
    // The partial unique index arbitrates concurrent identical proposals.
    // A losing writer reuses the winner instead of surfacing a duplicate card.
    const winner = await findActiveEnvelope(
      approvalBindingFingerprint,
      now,
      db,
    );
    if (!winner) throw err;
    created = winner;
  }

  await pauseBoundTask(input.binding.taskRunId, db);
  return created;
}

export async function findApprovedAuthorityEnvelope(
  binding: CoworkerApprovalBinding,
  now: Date = new Date(),
  db: AuthorityApprovalDb = prisma as unknown as AuthorityApprovalDb,
): Promise<{
  envelopeId: string;
  status: "approved";
  expiresAt: Date;
  binding: CoworkerApprovalBinding;
} | null> {
  const approvalBindingFingerprint =
    fingerprintCoworkerApprovalBinding(binding);
  const row = await db.coworkerActionEnvelope.findFirst({
    where: {
      approvalBindingFingerprint,
      status: "approved",
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, expiresAt: true, argsJson: true },
  });
  if (!row?.expiresAt) return null;

  const args =
    row.argsJson && typeof row.argsJson === "object"
      ? (row.argsJson as Record<string, unknown>)
      : null;
  const storedBinding = args?.approvalBinding;
  if (
    !storedBinding
    || typeof storedBinding !== "object"
    || fingerprintCoworkerApprovalBinding(
      storedBinding as CoworkerApprovalBinding,
    ) !== approvalBindingFingerprint
  ) {
    return null;
  }

  return {
    envelopeId: row.id,
    status: "approved",
    expiresAt: row.expiresAt,
    binding,
  };
}

export async function resumeAuthorityApprovalTask(
  taskRunId: string,
  markWorking: MarkTaskWorking = markTaskRunWorking,
): Promise<void> {
  await markWorking(taskRunId);
}

export async function finalizeAuthorityApprovalEnvelope(
  envelopeId: string,
  success: boolean,
  db: AuthorityApprovalDb = prisma as unknown as AuthorityApprovalDb,
): Promise<void> {
  await db.coworkerActionEnvelope.updateMany({
    where: { id: envelopeId, status: "approved" },
    data: {
      status: success ? "executed" : "failed",
      resolvedAt: new Date(),
    },
  });
}
