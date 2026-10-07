import { randomUUID } from "node:crypto";
import { prisma } from "@dpf/db";
import { FEDERATED_WORK_ORIGIN_MARKER_SQL_PREFIX } from "@dpf/db/federated-work-contract";
import { ASSESSMENT_DB_OUTCOMES, assessmentEligible, assessmentOutcomeFromDb, nextAssessment, triageFingerprint, TRIAGE_ASSESSMENT_KIND, type AssessmentOutcome } from "./backlog-triage-assessment";

const select = {
  id: true, itemId: true, title: true, body: true, type: true, workType: true,
  effortSize: true, proposedOutcome: true, updatedAt: true, status: true,
  triageAssessmentFingerprint: true, triageAssessmentOutcome: true, triageAssessmentAttempts: true,
  triageAssessmentRetryAt: true, triageAssessmentClaim: true, triageAssessedAt: true,
  activities: {
    where: { kind: "status_change", payload: { path: ["to"], equals: "triaging" } },
    orderBy: [{ recordedAt: "desc" as const }, { id: "desc" as const }],
    take: 1, select: { recordedAt: true },
  },
};
async function readRow(itemId: string) {
  return prisma.backlogItem.findUnique({ where: { itemId }, select });
}
type Row = NonNullable<Awaited<ReturnType<typeof readRow>>>;

function state(row: Row) {
  const retriaged = row.triageAssessedAt && row.activities[0] && row.activities[0].recordedAt > row.triageAssessedAt;
  const previous = retriaged ? null : {
    fingerprint: row.triageAssessmentFingerprint,
    outcome: assessmentOutcomeFromDb(row.triageAssessmentOutcome),
    attempts: row.triageAssessmentAttempts,
    retryAt: row.triageAssessmentRetryAt?.toISOString() ?? null,
  };
  return { previous, fingerprint: triageFingerprint(row) };
}

function owned(row: Row): boolean {
  return row.status === "triaging" && !row.body?.includes(FEDERATED_WORK_ORIGIN_MARKER_SQL_PREFIX);
}

/** Bounded scan with a durable cursor: held prefixes cannot starve later rows. */
export async function selectTriageBatch(limit: number, now: Date) {
  const job = await prisma.scheduledJob.findUnique({ where: { jobId: "backlog-triage-drain" }, select: { runCursor: true } });
  const cursor = job?.runCursor;
  const where = {
    status: "triaging",
    OR: [{ body: null }, { NOT: { body: { contains: FEDERATED_WORK_ORIGIN_MARKER_SQL_PREFIX } } }],
  };
  let rows = await prisma.backlogItem.findMany({ where: { ...where, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take: 1000, select });
  if (!rows.length && cursor) rows = await prisma.backlogItem.findMany({ where, orderBy: { id: "asc" }, take: 1000, select });
  const items: { itemId: string; fingerprint: string; updatedAt: string }[] = [];
  let held = 0;
  let nextCursor: string | null = null;
  for (const row of rows) {
    nextCursor = row.id;
    const { previous, fingerprint } = state(row);
    if (!assessmentEligible(row, previous, now)) { held++; continue; }
    items.push({ itemId: row.itemId, fingerprint, updatedAt: row.updatedAt.toISOString() });
    if (items.length === limit) break;
  }
  return { items, held, cursor: nextCursor };
}

/** A short claim transaction; never holds a lock across model inference. */
export async function beginTriage(itemId: string, expectedFingerprint: string, expectedUpdatedAt: string, now: Date) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`triage:${itemId}`}, 0))`;
    const row = await tx.backlogItem.findUnique({ where: { itemId }, select });
    if (!row || !owned(row) || row.updatedAt.toISOString() !== expectedUpdatedAt) return null;
    const { previous, fingerprint } = state(row);
    if (fingerprint !== expectedFingerprint || !assessmentEligible(row, previous, now)) return null;
    const attempts = previous?.fingerprint === fingerprint ? previous.attempts + 1 : 1;
    const assessment = nextAssessment(fingerprint, "in-flight", attempts, now);
    const claim = randomUUID();
    const claimed = await tx.backlogItem.updateMany({
      where: { id: row.id, status: "triaging", updatedAt: row.updatedAt },
      data: { triageAssessmentFingerprint: fingerprint, triageAssessmentOutcome: "inFlight", triageAssessmentAttempts: attempts, triageAssessmentRetryAt: assessment.retryAt ? new Date(assessment.retryAt) : null, triageAssessmentClaim: claim, triageAssessedAt: now, updatedAt: now },
    });
    if (!claimed.count) return null;
    const activity = await tx.backlogItemActivity.create({ data: { backlogItemId: row.id, kind: TRIAGE_ASSESSMENT_KIND, summary: "Scheduled triage assessment started", payload: assessment } });
    return { row: { ...row, updatedAt: now }, activityId: activity.id, claim, attempts, fingerprint };
  });
}

export async function finishTriage(activityId: string, fingerprint: string, attempts: number, outcome: AssessmentOutcome, now: Date, rationale: string | undefined, backlogItemId: string, claim: string) {
  const assessment = nextAssessment(fingerprint, outcome, attempts, now, rationale);
  await prisma.$transaction(async tx => {
    // Expired/replaced workers may finish their audit, never the newer projection.
    await tx.backlogItem.updateMany({ where: { id: backlogItemId, triageAssessmentClaim: claim }, data: { triageAssessmentOutcome: ASSESSMENT_DB_OUTCOMES[outcome], triageAssessmentRetryAt: assessment.retryAt ? new Date(assessment.retryAt) : null, triageAssessmentClaim: null } });
    await tx.backlogItemActivity.update({ where: { id: activityId }, data: { summary: `Scheduled triage: ${outcome}`, payload: assessment } });
  });
}

export async function applyTriageBuild(row: Row, claim: string, effortSize: string, rationale: string): Promise<boolean> {
  // Status/version/claim checks are one atomic statement, including manual edits.
  const result = await prisma.backlogItem.updateMany({
    where: { id: row.id, status: "triaging", updatedAt: row.updatedAt, triageAssessmentClaim: claim },
    data: { status: "open", triageOutcome: "build", effortSize, resolution: rationale },
  });
  return result.count === 1;
}
