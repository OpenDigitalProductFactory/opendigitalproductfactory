// Make embedding-coverage repair VISIBLE (BI-ED117C82).
//
// A self-heal nobody can observe is indistinguishable from one that never runs —
// which is exactly how the previous boot hook failed: it had no caller at all
// for months while a source comment claimed it was wired, and nothing on any
// surface would have shown the difference.
//
// So every run reports into a durable Workroom. The Workroom is the collection
// point for outcome-specific activity an AI coworker manages on the operator's
// behalf: the operator sees "corpus health" as an outcome with a history, rather
// than being expected to know what an embedding is. Cognitive load moves human →
// coworker → code; the code says what it did, in numbers, without being asked.

import {
  CORPUS_HEALTH_WORKROOM_ID,
  CORPUS_HEALTH_WORKROOM_OBJECTIVE,
  CORPUS_HEALTH_WORKROOM_TITLE,
  EMBEDDING_COVERAGE_ACTIVITY_KIND,
} from "./embedding-coverage-constants";
import type { WikiEmbeddingReconciliationResult } from "./embedding-reconciliation";

/** Structural client — satisfied by PrismaClient and by test fakes. */
export type CorpusHealthClient = {
  workroom: {
    upsert(args: unknown): Promise<{ id: string }>;
  };
  workroomActivity: {
    create(args: unknown): Promise<unknown>;
  };
};

export type CoverageReport = {
  /** Published pages carrying a vector. */
  covered: number;
  /** Published pages scanned. */
  scanned: number;
  /** Pages re-embedded on this run. */
  repaired: number;
  /** True when nothing could be attempted because the provider was down. */
  providerUnavailable: boolean;
  /** Operator-facing one-liner — no jargon, states what happens next. */
  summary: string;
};

/**
 * Turn a reconcile result into something an operator can read.
 *
 * Deliberately says what it MEANS, not what ran: a partially embedded corpus
 * presents to the operator as coworkers re-asking settled questions, and that
 * connection is invisible unless this text makes it.
 */
export function describeCoverage(result: WikiEmbeddingReconciliationResult): CoverageReport {
  const covered = result.scanned - result.failed.length;
  const base = `${covered} of ${result.scanned} reference pages are searchable by your coworkers`;

  if (result.providerUnavailable) {
    return {
      covered,
      scanned: result.scanned,
      repaired: 0,
      providerUnavailable: true,
      summary:
        `${base}. ${result.missing} could not be processed because the local AI model was busy — `
        + "nothing was lost and this retries automatically within a couple of hours. "
        + "Until then your coworkers may ask about things you have already decided.",
    };
  }

  if (result.failed.length > 0) {
    return {
      covered,
      scanned: result.scanned,
      repaired: result.embedded,
      providerUnavailable: false,
      summary:
        `${base}. Repaired ${result.embedded}; ${result.failed.length} still failing and will be retried. `
        + "Pages that are not searchable can cause a coworker to re-ask something you have already settled.",
    };
  }

  return {
    covered,
    scanned: result.scanned,
    repaired: result.embedded,
    providerUnavailable: false,
    summary: result.embedded > 0
      ? `${base} — repaired ${result.embedded} that had been missed.`
      : `${base}. Nothing needed repair.`,
  };
}

/**
 * Record one coverage run against the durable corpus-health Workroom.
 *
 * Upserts the Workroom so the first run on a fresh install creates it; never
 * throws, because visibility must not be able to break the repair it reports on.
 */
export async function recordCoverageRun(input: {
  db: CorpusHealthClient;
  result: WikiEmbeddingReconciliationResult;
  logger?: Pick<Console, "warn">;
}): Promise<CoverageReport> {
  const report = describeCoverage(input.result);
  try {
    const room = await input.db.workroom.upsert({
      where: { capsuleId: CORPUS_HEALTH_WORKROOM_ID },
      update: { status: "working" },
      create: {
        capsuleId: CORPUS_HEALTH_WORKROOM_ID,
        title: CORPUS_HEALTH_WORKROOM_TITLE,
        objective: CORPUS_HEALTH_WORKROOM_OBJECTIVE,
        status: "working",
        source: "platform-maintenance",
        activityKind: EMBEDDING_COVERAGE_ACTIVITY_KIND,
      },
    });
    await input.db.workroomActivity.create({
      data: {
        workCapsuleId: room.id,
        kind: EMBEDDING_COVERAGE_ACTIVITY_KIND,
        summary: report.summary,
        payload: {
          covered: report.covered,
          scanned: report.scanned,
          repaired: report.repaired,
          providerUnavailable: report.providerUnavailable,
          stillFailing: input.result.failed.slice(0, 20),
        },
      },
    });
  } catch (err) {
    (input.logger ?? console).warn(
      "[wiki-embeddings] Could not record coverage to the corpus-health Workroom (non-fatal):",
      err,
    );
  }
  return report;
}
