// The journey watchdog sweep.
// Spec: docs/superpowers/specs/2026-07-28-critical-business-journey-watchdog-design.md
//
// Mirrors lib/coworker-lifecycle/certification-runner.ts deliberately: one
// AssuranceRun per subject, AssuranceFindings for what failed, absent-clean
// resolution for what stopped reproducing. Same evidence store, same shape — a
// reviewer who knows one knows the other.
//
// Cheapest-first is structural, not advisory: a step is SKIPPED once an earlier
// step in the same journey failed, so a storefront that is down costs one HTTP
// call rather than a transaction rehearsal that was never going to succeed.

import { prisma } from "@dpf/db";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { achievedDepth, uncheckedDepths } from "./depth";
import { resolveInstallJourneyContext } from "./install-context";
import { reconcileJourneyIssues } from "./issue";
import { BUSINESS_JOURNEYS } from "./registry";
import {
  JOURNEY_ADAPTER_KEY,
  JOURNEY_ADAPTER_VERSION,
  JOURNEY_ASSURANCE_SCOPE_TYPE,
  type InstallJourneyContext,
  type JourneyDefinition,
  type JourneyResult,
  type JourneyStepResult,
  type JourneySweepResult,
  type StepProbeResult,
} from "./types";

export type JourneySweepDeps = {
  db: typeof prisma;
  fetchImpl: typeof fetch;
  now: () => Date;
  resolveContext: (db: typeof prisma) => Promise<InstallJourneyContext>;
  journeys: readonly JourneyDefinition[];
};

function defaultDeps(): JourneySweepDeps {
  return {
    db: prisma,
    fetchImpl: fetch,
    now: () => new Date(),
    resolveContext: resolveInstallJourneyContext,
    journeys: BUSINESS_JOURNEYS,
  };
}

/** Run one journey's steps, cheapest-first, stopping deeper work after a failure. */
export async function runJourney(
  journey: JourneyDefinition,
  ctx: InstallJourneyContext,
  deps: Pick<JourneySweepDeps, "fetchImpl" | "now">,
): Promise<JourneyResult> {
  const journeyStartedAt = deps.now().getTime();
  const probeCtx = { ...ctx, fetchImpl: deps.fetchImpl, now: deps.now };
  const steps: JourneyStepResult[] = [];
  let failedAlready = false;

  for (const step of journey.steps) {
    if (failedAlready) {
      steps.push({
        stepId: step.stepId,
        label: step.label,
        depth: step.depth,
        outcome: "skipped",
        detail: "Not checked — an earlier step in this journey already failed.",
        durationMs: 0,
      });
      continue;
    }
    const stepStartedAt = deps.now().getTime();
    let result: StepProbeResult;
    try {
      result = await step.run(probeCtx);
    } catch (err) {
      // A probe that throws is a failed step with evidence, never an unhandled
      // rejection that kills the sweep for every other journey.
      result = {
        passed: false,
        detail: "The check could not complete.",
        expected: "the check to run to completion",
        actual: getErrorMessage(err),
      };
    }
    if (!result.passed) failedAlready = true;
    steps.push({
      stepId: step.stepId,
      label: step.label,
      depth: step.depth,
      outcome: result.passed ? "passed" : "failed",
      detail: result.detail,
      ...(result.expected !== undefined ? { expected: result.expected } : {}),
      ...(result.actual !== undefined ? { actual: result.actual } : {}),
      durationMs: deps.now().getTime() - stepStartedAt,
    });
  }

  const status = failedAlready ? "failed" : "passed";
  const depth = status === "passed" ? achievedDepth(steps) : null;
  return {
    journeyId: journey.journeyId,
    outcome: journey.outcome,
    businessImpact: journey.businessImpact,
    revenueBearing: journey.revenueBearing,
    status,
    achievedDepth: depth,
    uncheckedDepths: uncheckedDepths(depth),
    steps,
    durationMs: deps.now().getTime() - journeyStartedAt,
  };
}

function notApplicable(journey: JourneyDefinition): JourneyResult {
  return {
    journeyId: journey.journeyId,
    outcome: journey.outcome,
    businessImpact: journey.businessImpact,
    revenueBearing: journey.revenueBearing,
    status: "not-applicable",
    achievedDepth: null,
    // A journey that does not apply is not a coverage gap — nothing about it
    // was left unchecked, because there was nothing to check.
    uncheckedDepths: [],
    notApplicableReason: journey.notApplicableReason,
    steps: [],
    durationMs: 0,
  };
}

/**
 * Run every journey, persist evidence, and reconcile the operator inbox.
 *
 * Never throws for a journey-level failure — a broken journey is the output,
 * not an exception.
 */
export async function runJourneySweep(
  overrides: Partial<JourneySweepDeps> = {},
): Promise<JourneySweepResult> {
  const deps: JourneySweepDeps = { ...defaultDeps(), ...overrides };
  const startedAt = deps.now();
  const ctx = await deps.resolveContext(deps.db);

  const results: JourneyResult[] = [];
  for (const journey of deps.journeys) {
    results.push(
      journey.appliesWhen(ctx)
        ? await runJourney(journey, ctx, deps)
        : notApplicable(journey),
    );
  }

  const completedAt = deps.now();
  const runId = `assurance_journey_${startedAt.toISOString().replace(/[^a-zA-Z0-9]/g, "_")}`;

  await persistSweep(runId, results, startedAt, completedAt, deps);
  // `as never` matches the existing convention for the narrow monitor-issue
  // surface (see alert-delivery-bridge.ts): Prisma's generic delegate signatures
  // do not structurally satisfy the hand-written test seam.
  await reconcileJourneyIssues(deps.db as never, results, runId, deps.now);

  return {
    runId,
    startedAt,
    completedAt,
    journeys: results,
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    notApplicable: results.filter((r) => r.status === "not-applicable").length,
  };
}

function findingKey(journeyId: string, stepId: string): string {
  return `journey-watchdog:${journeyId}:${stepId}`;
}

async function persistSweep(
  runId: string,
  results: readonly JourneyResult[],
  startedAt: Date,
  completedAt: Date,
  deps: JourneySweepDeps,
): Promise<void> {
  const anyFailed = results.some((r) => r.status === "failed");

  await deps.db.assuranceRun.create({
    data: {
      runId,
      scopeType: JOURNEY_ASSURANCE_SCOPE_TYPE,
      // Single-org install: the sweep's subject is the install itself.
      scopeId: "install",
      adapterKey: JOURNEY_ADAPTER_KEY,
      adapterVersion: JOURNEY_ADAPTER_VERSION,
      status: anyFailed ? "failed" : "passed",
      startedAt,
      completedAt,
      summary: {
        journeys: results.map((r) => ({
          journeyId: r.journeyId,
          outcome: r.outcome,
          status: r.status,
          achievedDepth: r.achievedDepth,
          uncheckedDepths: r.uncheckedDepths,
          notApplicableReason: r.notApplicableReason ?? null,
          durationMs: r.durationMs,
          steps: r.steps,
        })),
      },
    },
  });

  const activeKeys: string[] = [];
  for (const journey of results) {
    for (const step of journey.steps) {
      if (step.outcome !== "failed") continue;
      const key = findingKey(journey.journeyId, step.stepId);
      activeKeys.push(key);
      const base = {
        findingKind: "business-journey",
        title: `${journey.outcome} — ${step.label} failed`,
        description: step.detail,
        affectedType: JOURNEY_ASSURANCE_SCOPE_TYPE,
        affectedId: journey.journeyId,
        adapterKey: JOURNEY_ADAPTER_KEY,
        vendorIdentifier: step.stepId,
        policySeverity: journey.revenueBearing ? "high" : "medium",
        releaseImpact: "track",
        lastSeenAt: completedAt,
        source: { adapterKey: JOURNEY_ADAPTER_KEY, journeyId: journey.journeyId, runId },
        evidence: {
          expected: step.expected ?? null,
          actual: step.actual ?? null,
          depth: step.depth,
          steps: journey.steps,
        },
      };
      const existing = await deps.db.assuranceFinding.findUnique({ where: { findingKey: key } });
      if (existing) {
        await deps.db.assuranceFinding.update({
          where: { findingKey: key },
          data: {
            ...base,
            ...(existing.status === "resolved"
              ? { status: "open", resolvedAt: null, reopenCount: { increment: 1 } }
              : {}),
          },
        });
      } else {
        await deps.db.assuranceFinding.create({
          data: { ...base, findingKey: key, status: "open", firstSeenAt: completedAt },
        });
      }
    }
  }

  // Absent-clean: journey findings that did not reproduce this sweep are resolved.
  await deps.db.assuranceFinding.updateMany({
    where: {
      adapterKey: JOURNEY_ADAPTER_KEY,
      status: { in: ["open", "planned", "blocked"] },
      ...(activeKeys.length > 0 ? { findingKey: { notIn: activeKeys } } : {}),
    },
    data: { status: "resolved", resolvedAt: completedAt },
  });
}
