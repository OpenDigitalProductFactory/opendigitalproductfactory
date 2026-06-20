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

/** 16-hex fingerprint of (source, signature). Exported for tests + callers. */
export function correctiveFingerprint(source: string, signature: string): string {
  return createHash("sha256").update(`${source}|${signature}`).digest("hex").slice(0, 16);
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
