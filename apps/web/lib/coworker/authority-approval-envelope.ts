import "server-only";

import { createHash } from "node:crypto";

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
  /**
   * The envelope's threadId is a NOT NULL foreign key to AgentThread, so an
   * approval raised outside a chat needs a real thread to live in (BI-4D6C21A7).
   */
  agentThread: { upsert(args: unknown): Promise<{ id: string }> };
};

type MarkTaskWorking = (taskRunId: string) => Promise<boolean | void>;

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

/**
 * The AgentThread an approval card lives in.
 *
 * `CoworkerActionEnvelope.threadId` is NOT NULL with a foreign key to
 * AgentThread. This used to fall back to a synthesized string —
 * `task:<taskRunId>` or `authority:<agentId>` — which is not an AgentThread id,
 * so the insert violated the FK, `ensureAuthorityApprovalEnvelope` threw, and
 * the caller reported `authority_evidence_unavailable`: "approval evidence
 * could not be recorded... the check itself was unavailable, and the call can be
 * retried unchanged." It was retried unchanged, forever, and could never
 * succeed — 229 recorded failures of the Build Studio research attestation
 * alone, which is what kept RESEARCH_REQUIRED unsatisfiable and every
 * decomposition child stuck short of `build`.
 *
 * An approval genuinely needs somewhere to render for the human who must answer
 * it, so the honest fix is to create that somewhere rather than to invent an id
 * for a row that does not exist.
 *
 * The id is derived deterministically from the same key the old string used, so
 * repeated approvals in one authority context reuse one thread instead of
 * spawning one per attempt, and concurrent writers collide on the primary key
 * rather than racing.
 */
async function ensureApprovalThread(
  binding: CoworkerApprovalBinding,
  db: AuthorityApprovalDb,
): Promise<string> {
  const key = binding.taskRunId
    ? `task:${binding.taskRunId}`
    : `authority:${binding.actingAgentId}`;
  const id = `thr-authority-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
  const thread = await db.agentThread.upsert({
    where: { id },
    update: {},
    create: {
      id,
      userId: binding.actingHumanUserId,
      contextKey: `authority:${binding.toolName}`,
    },
  });
  return thread.id;
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
        threadId: input.threadId ?? (await ensureApprovalThread(input.binding, db)),
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

/**
 * BI-12E5DD91 — the recorded outcome of an identical call that already ran on
 * a person's approval. A caller that retries after approval gets that outcome
 * instead of a second run or a second card. Only a successful run within the
 * approval window counts; a failed or declined one may be asked again.
 */
/**
 * The settled outcome of an identical call a person already approved, within
 * the approval window: the result it ran with, or, for a run that failed
 * (BI-F4EB23C1), the failure it recorded. A failed approval is an outcome too;
 * treating it as absent minted a fresh card for every retry of a call that
 * could not succeed.
 */
export async function findExecutedAuthorityOutcome(
  binding: CoworkerApprovalBinding,
  now: Date = new Date(),
  db: AuthorityApprovalDb & {
    toolExecution: {
      findFirst(args: unknown): Promise<{ result: unknown } | null>;
      findMany(args: unknown): Promise<Array<{ result: unknown }>>;
    };
  } = prisma as never,
): Promise<SettledAuthorityOutcome | null> {
  const envelope = await db.coworkerActionEnvelope.findFirst({
    where: {
      approvalBindingFingerprint: fingerprintCoworkerApprovalBinding(binding),
      status: { in: ["executed", "failed"] },
      resolvedAt: { gt: new Date(now.getTime() - AUTHORITY_APPROVAL_TTL_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, expiresAt: true },
  });
  if (!envelope) return null;
  if (envelope.status === "executed") {
    const run = await db.toolExecution.findFirst({
      where: { envelopeId: envelope.id, success: true },
      orderBy: { createdAt: "desc" },
      select: { result: true },
    });
    return run ? { envelopeId: envelope.id, status: "executed", result: run.result } : null;
  }
  // The same envelope also carries the original approval_required row and the
  // approval_outcome receipt; the failure is the run that is neither.
  const runs = await db.toolExecution.findMany({
    where: { envelopeId: envelope.id, success: false, toolName: { not: "approval_outcome" } },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { result: true },
  });
  const failure = runs.find((run) => {
    const result = run.result && typeof run.result === "object" ? run.result as Record<string, unknown> : null;
    return result?.["error"] !== "approval_required";
  });
  return { envelopeId: envelope.id, status: "failed", result: failure?.result ?? null };
}

export type SettledAuthorityOutcome = { envelopeId: string; status: "executed" | "failed"; result: unknown };

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
