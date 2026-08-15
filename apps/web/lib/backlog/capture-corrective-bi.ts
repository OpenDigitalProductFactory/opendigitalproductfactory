// apps/web/lib/backlog/capture-corrective-bi.ts
//
// Best-effort capture of a build / self-upgrade FAILURE into a fingerprinted
// corrective BacklogItem. (BI-9EA09823)
//
// "Every bug is a permanent upgrade" is systematized for incidents -> CI guards,
// but the failure -> capture half was voluntary: Build Studio build failures and
// self-upgrade failures auto-filed nothing. This turns "an agent must remember
// to call record_functional_failure_evidence" into "the failure chokepoint
// always captures."
//
// Deduped by failure SIGNATURE (never a run/build id) so a recurring failure
// increments occurrenceCount instead of spamming new items — the same mechanic
// the record_functional_failure_evidence tool uses (mcp-tools.ts), extracted
// here so the orchestrator / self-upgrade runner can call it server-side.
//
// NEVER throws: a failure inside capture must not corrupt the failure path that
// called it.

import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@dpf/db";

export type CorrectiveFailureSource = "build-failure" | "self-upgrade-failure";

export type CorrectiveFailureInput = {
  source: CorrectiveFailureSource;
  /**
   * Stable failure SIGNATURE — a description of *how* it failed, NEVER a
   * run/build id. This is what the fingerprint hashes, so two runs that fail
   * the same way dedup to one item.
   */
  signature: string;
  title: string;
  /** Free-text detail. The `failureFingerprint:` line is prepended by the helper. */
  body: string;
  submittedById?: string | null;
  agentId?: string | null;
};

export type CorrectiveCaptureResult =
  | { action: "created" | "updated"; itemId: string; fingerprint: string }
  | { action: "skipped"; reason: string };

export type CorrectiveRecoveryIdentity = {
  runId: string;
  currentSha?: string | null;
  targetSha?: string | null;
  deployedSha?: string | null;
  completedAt: Date | string;
};

export type CorrectiveRecoveryResult =
  | { action: "recorded"; itemIds: string[]; activityCount: number }
  | { action: "skipped"; reason: string };

/** 16-hex fingerprint of (source, signature). Exported for tests + callers. */
export function correctiveFingerprint(source: string, signature: string): string {
  return createHash("sha256").update(`${source}|${signature}`).digest("hex").slice(0, 16);
}

function correctiveRecoveryActivityId(backlogItemId: string, runId: string): string {
  const digest = createHash("sha256").update(`${backlogItemId}|${runId}`).digest("hex").slice(0, 24);
  return `recovery_${digest}`;
}

export async function captureCorrectiveFailureBI(
  input: CorrectiveFailureInput,
): Promise<CorrectiveCaptureResult> {
  const fingerprint = correctiveFingerprint(input.source, input.signature);
  try {
    // Dedup on the fingerprint stored as a body line (mirrors the
    // functional-test-failure dedup query) scoped to this source so the
    // build / self-upgrade / functional-test spaces never cross-collide.
    const existing = await prisma.backlogItem.findFirst({
      where: {
        source: input.source,
        status: { notIn: ["done", "deferred"] },
        body: { contains: `failureFingerprint: ${fingerprint}` },
      },
      select: { id: true, itemId: true },
    });

    if (existing) {
      await prisma.backlogItem.update({
        where: { id: existing.id },
        data: { occurrenceCount: { increment: 1 }, lastSeenAt: new Date() },
      });
      return { action: "updated", itemId: existing.itemId, fingerprint };
    }

    const created = await prisma.backlogItem.create({
      data: {
        itemId: `BI-${randomUUID().slice(0, 8).toUpperCase()}`,
        title: input.title.slice(0, 200),
        type: "product",
        workType: "bug",
        status: "triaging",
        source: input.source,
        submittedById: input.submittedById ?? null,
        agentId: input.agentId ?? null,
        lastSeenAt: new Date(),
        body: `failureFingerprint: ${fingerprint}\n${input.body}`,
      },
      select: { itemId: true },
    });
    return { action: "created", itemId: created.itemId, fingerprint };
  } catch (err) {
    // Best-effort: log loudly (make-silent-failures-observable) but never throw.
    // eslint-disable-next-line no-console
    console.error("[capture-corrective-bi] best-effort capture failed:", err);
    return { action: "skipped", reason: "error" };
  }
}

/**
 * Attach a successful recovery observation to every still-active corrective
 * item for one failure source. This deliberately does NOT create completion
 * evidence or mutate item status: one successful run proves recovery of the
 * governed path, not that every historical failure class is impossible.
 *
 * Like failure capture, this is best-effort. Evidence storage must never turn
 * a durably successful runtime transition into a failure.
 */
export async function recordCorrectiveRecoveryEvidence(input: {
  source: CorrectiveFailureSource;
  recovery: CorrectiveRecoveryIdentity;
}): Promise<CorrectiveRecoveryResult> {
  const summary = `Recovery observed in ${input.recovery.runId}`;
  try {
    const items = await prisma.backlogItem.findMany({
      where: {
        source: input.source,
        status: { notIn: ["done", "deferred"] },
      },
      select: { id: true, itemId: true, body: true },
    });

    if (items.length === 0) {
      return { action: "recorded", itemIds: [], activityCount: 0 };
    }

    const existing = await prisma.backlogItemActivity.findMany({
      where: {
        backlogItemId: { in: items.map((item) => item.id) },
        kind: "recovery_observed",
        summary,
      },
      select: { backlogItemId: true },
    });
    const alreadyRecorded = new Set(existing.map((activity) => activity.backlogItemId));
    const pending = items.filter((item) => !alreadyRecorded.has(item.id));

    if (pending.length === 0) {
      return { action: "recorded", itemIds: [], activityCount: 0 };
    }

    const completedAt = input.recovery.completedAt instanceof Date
      ? input.recovery.completedAt.toISOString()
      : new Date(input.recovery.completedAt).toISOString();
    const result = await prisma.backlogItemActivity.createMany({
      data: pending.map((item) => ({
        id: correctiveRecoveryActivityId(item.id, input.recovery.runId),
        backlogItemId: item.id,
        kind: "recovery_observed",
        summary,
        payload: {
          source: input.source,
          failureFingerprint: item.body?.match(/^failureFingerprint:\s*([0-9a-f]{16})$/m)?.[1] ?? null,
          recoveryRunId: input.recovery.runId,
          currentSha: input.recovery.currentSha ?? null,
          targetSha: input.recovery.targetSha ?? null,
          deployedSha: input.recovery.deployedSha ?? null,
          completedAt,
          statusMutated: false,
        },
      })),
      // The deterministic activity id makes concurrent/replayed terminal
      // reconciliation idempotent at the database boundary, not just in the
      // optimistic pre-read above.
      skipDuplicates: true,
    });

    return {
      action: "recorded",
      // A concurrent reconciler may have inserted some deterministic rows
      // between the pre-read and createMany. Only claim exact item identities
      // when this invocation inserted the complete pending set.
      itemIds: result.count === pending.length
        ? pending.map((item) => item.itemId)
        : [],
      activityCount: result.count,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[capture-corrective-bi] best-effort recovery evidence failed:", err);
    return { action: "skipped", reason: "error" };
  }
}
