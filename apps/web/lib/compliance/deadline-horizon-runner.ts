// apps/web/lib/compliance/deadline-horizon-runner.ts
//
// I/O half of the `deadline-horizon` trigger: read the compliance substrate,
// run the pure sweep, open an AssuranceRun, and raise/reconcile findings on the
// existing Assurance Ledger. No new ledger, no new finding table — an
// obligation deadline is an assurance finding whose adapter happens to be the
// compliance sweep rather than a scanner.

import { persistAssuranceFindings } from "@/lib/assurance/finding-persistence";
import { OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY } from "@/lib/work-management/work-shapes";
import {
  DEADLINE_HORIZON_ADAPTER_KEY,
  DEADLINE_HORIZON_ADAPTER_VERSION,
  DEFAULT_HORIZON_DAYS,
  sweepDeadlineHorizon,
  type DeadlineHorizonResult,
} from "./deadline-horizon-sweep";

/** Bounded reads — a compliance estate is small, and an unbounded scan is a defect. */
const MAX_ROWS_PER_TABLE = 1_000;

export const DEADLINE_HORIZON_SCOPE_TYPE = "compliance";
export const DEADLINE_HORIZON_SCOPE_ID = "organization";

type FindManyDelegate = { findMany(args: unknown): Promise<unknown[]> };

export type DeadlineHorizonDb = {
  obligation: FindManyDelegate;
  control: FindManyDelegate;
  licenseRequirementReference: FindManyDelegate;
  assuranceRun: { create(args: unknown): Promise<{ id: string; runId: string }> };
  assuranceFinding: {
    findMany(args: unknown): Promise<unknown[]>;
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
};

export type DeadlineHorizonRunResult = DeadlineHorizonResult & {
  runId: string;
  created: number;
  updated: number;
  reopened: number;
  reconciled: number;
};

/**
 * Run one sweep. `now` is injected so the job, the tests, and a manual run all
 * agree on the horizon they are measuring against.
 */
export async function runDeadlineHorizonSweep(
  db: DeadlineHorizonDb,
  options: { now: Date; horizonDays?: number; runKey?: string },
): Promise<DeadlineHorizonRunResult> {
  const horizonDays = options.horizonDays ?? DEFAULT_HORIZON_DAYS;

  const [obligations, controls, licenseReferences] = await Promise.all([
    db.obligation.findMany({
      where: { status: "active" },
      select: { obligationId: true, title: true, frequency: true, reviewDate: true, status: true },
      orderBy: { reviewDate: "asc" },
      take: MAX_ROWS_PER_TABLE,
    }),
    db.control.findMany({
      where: { status: "active" },
      select: {
        controlId: true, title: true, reviewFrequency: true,
        lastReviewedAt: true, nextReviewDate: true, status: true,
      },
      orderBy: { nextReviewDate: "asc" },
      take: MAX_ROWS_PER_TABLE,
    }),
    db.licenseRequirementReference.findMany({
      select: {
        requirementRefId: true, jurisdictionLabel: true, requirementType: true,
        staleAfterDays: true, renewalCadenceHint: true, lastVerifiedAt: true,
      },
      orderBy: { lastVerifiedAt: "asc" },
      take: MAX_ROWS_PER_TABLE,
    }),
  ]);

  const swept = sweepDeadlineHorizon({
    now: options.now,
    horizonDays,
    obligations: obligations as never,
    controls: controls as never,
    licenseReferences: licenseReferences as never,
  });

  const runKey = options.runKey ?? options.now.toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  // Not `createAssuranceRun` — that writer is build-scoped by contract
  // (scopeType "build", a buildId FK, and unique ToolExecution FKs). This run
  // is scoped to the compliance estate and has no build and no tool execution
  // behind it, so it writes its own row rather than faking those foreign keys.
  const run = await db.assuranceRun.create({
    data: {
      runId: `assurance_obligations_${runKey}`,
      scopeType: DEADLINE_HORIZON_SCOPE_TYPE,
      scopeId: DEADLINE_HORIZON_SCOPE_ID,
      adapterKey: DEADLINE_HORIZON_ADAPTER_KEY,
      adapterVersion: DEADLINE_HORIZON_ADAPTER_VERSION,
      status: swept.stoppedBy ? "partial" : "passed",
      summary: {
        horizonDays: swept.horizonDays,
        scanned: swept.scanned,
        findings: swept.findings.length,
        stoppedBy: swept.stoppedBy,
        shape: `${OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY}@1.0.0`,
        trigger: "deadline-horizon",
      },
      startedAt: options.now,
      completedAt: options.now,
    },
  });

  const persisted = await persistAssuranceFindings(db, {
    assuranceRunId: run.id,
    findings: swept.findings,
    observedAt: options.now,
  });

  // Reconcile: a due date that has been dealt with leaves the horizon, and its
  // finding must close. `persistAssuranceFindings` only auto-resolves in a
  // build scope, so the compliance scope reconciles its own adapter here.
  // A FAILURE stop means the substrate was unreadable — resolving anything on
  // an unread sweep would report compliance the sweep never observed.
  let reconciled = 0;
  if (!swept.stoppedBy) {
    const seen = new Set(swept.findings.map((finding) => finding.findingKey));
    const stale = (await db.assuranceFinding.findMany({
      where: {
        adapterKey: DEADLINE_HORIZON_ADAPTER_KEY,
        status: { in: ["open", "planned", "blocked"] },
        findingKey: { notIn: [...seen] },
      },
      select: { findingKey: true },
      take: MAX_ROWS_PER_TABLE,
    })) as Array<{ findingKey: string }>;
    for (const row of stale) {
      await db.assuranceFinding.update({
        where: { findingKey: row.findingKey },
        data: { status: "resolved", resolvedAt: options.now },
      });
      reconciled += 1;
    }
  }

  return { ...swept, runId: run.runId, ...persisted, reconciled };
}
