import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PLATFORM_GUARDRAILS = Object.freeze(require(
  "../../apps/web/lib/nonprod/local-ci-pilot-guardrails.json",
));

export const LOCAL_CI_PILOT_REPORT_VERSION = 1;

export const DEFAULT_LOCAL_CI_PILOT_THRESHOLDS = PLATFORM_GUARDRAILS;

const durationFields = [
  "medianQueueWaitMs",
  "p95QueueWaitMs",
  "medianCycleMs",
  "medianServiceDurationMs",
  "throughputPerHour",
];

const defectCountFields = [
  "isolationDefectCount",
  "evidenceMismatchCount",
  "unattributedFailureCount",
  "pressureCeilingBreachCount",
  "dockerHealthFailureCount",
  "controlPlaneStarvationCount",
];

function validWindow(value, { pilot = false } = {}) {
  return value !== null
    && typeof value === "object"
    && Number.isInteger(value.sampleCount)
    && value.sampleCount >= 0
    && durationFields.every((field) => (
      typeof value[field] === "number"
      && Number.isFinite(value[field])
      && value[field] >= 0
    ))
    && typeof value.infrastructureFailureRatePercent === "number"
    && Number.isFinite(value.infrastructureFailureRatePercent)
    && value.infrastructureFailureRatePercent >= 0
    && value.infrastructureFailureRatePercent <= 100
    && (!pilot || defectCountFields.every((field) => (
      Number.isInteger(value[field])
      && value[field] >= 0
    )));
}

function percentChange(baseline, current) {
  if (baseline === 0) return current === 0 ? 0 : Number.POSITIVE_INFINITY;
  return ((current - baseline) / baseline) * 100;
}

function rounded(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : value;
}

/**
 * Turn a capacity-one baseline and capacity-two evidence window into an
 * explicit retain/tune/rollback recommendation. Safety failures dominate
 * throughput; incomplete or incomparable evidence can only recommend tuning.
 */
export function evaluateLocalCiPilot({
  baseline,
  pilot,
  policy,
}) {
  // These are platform guardrails, not evidence inputs. Letting the evidence
  // payload supply thresholds would allow a client to grade its own safety.
  const rollback = policy?.rollback;
  const thresholds = Object.freeze({
    ...DEFAULT_LOCAL_CI_PILOT_THRESHOLDS,
    maximumMedianServiceDurationRegressionPercent: Math.min(
      DEFAULT_LOCAL_CI_PILOT_THRESHOLDS
        .maximumMedianServiceDurationRegressionPercent,
      typeof rollback?.maxServiceDurationRegressionPercent === "number"
        && Number.isFinite(rollback.maxServiceDurationRegressionPercent)
        && rollback.maxServiceDurationRegressionPercent >= 0
        ? rollback.maxServiceDurationRegressionPercent
        : DEFAULT_LOCAL_CI_PILOT_THRESHOLDS
          .maximumMedianServiceDurationRegressionPercent,
    ),
    maximumInfrastructureFailureRatePercent: Math.min(
      DEFAULT_LOCAL_CI_PILOT_THRESHOLDS
        .maximumInfrastructureFailureRatePercent,
      typeof rollback?.maxInfrastructureFailureRatePercent === "number"
        && Number.isFinite(rollback.maxInfrastructureFailureRatePercent)
        && rollback.maxInfrastructureFailureRatePercent >= 0
        ? rollback.maxInfrastructureFailureRatePercent
        : DEFAULT_LOCAL_CI_PILOT_THRESHOLDS
          .maximumInfrastructureFailureRatePercent,
    ),
  });
  const blockers = [];
  const advisories = [];

  if (!validWindow(baseline)) {
    blockers.push("baseline-evidence-invalid");
  }
  if (!validWindow(pilot, { pilot: true })) {
    blockers.push("pilot-evidence-invalid");
  }

  if (blockers.length > 0) {
    return {
      reportVersion: LOCAL_CI_PILOT_REPORT_VERSION,
      recommendation: "rollback",
      thresholds,
      comparison: null,
      blockers,
      advisories,
    };
  }

  const comparison = {
    p95QueueWaitImprovementPercent: rounded(
      -percentChange(baseline.p95QueueWaitMs, pilot.p95QueueWaitMs),
    ),
    medianQueueWaitImprovementPercent: rounded(
      -percentChange(baseline.medianQueueWaitMs, pilot.medianQueueWaitMs),
    ),
    medianCycleImprovementPercent: rounded(
      -percentChange(baseline.medianCycleMs, pilot.medianCycleMs),
    ),
    medianServiceDurationRegressionPercent: rounded(
      percentChange(
        baseline.medianServiceDurationMs,
        pilot.medianServiceDurationMs,
      ),
    ),
    throughputImprovementPercent: rounded(
      percentChange(baseline.throughputPerHour, pilot.throughputPerHour),
    ),
    sampleRatio: rounded(pilot.sampleCount / baseline.sampleCount),
  };

  if (pilot.isolationDefectCount > 0) blockers.push("isolation-defect-observed");
  if (pilot.evidenceMismatchCount > 0) blockers.push("evidence-mismatch-observed");
  if (pilot.unattributedFailureCount > 0) blockers.push("failure-attribution-lost");
  if (pilot.pressureCeilingBreachCount > 0) {
    blockers.push("host-pressure-ceiling-breached");
  }
  if (pilot.dockerHealthFailureCount > 0) blockers.push("docker-health-degraded");
  if (pilot.controlPlaneStarvationCount > 0) {
    blockers.push("control-plane-starvation-observed");
  }
  if (
    comparison.medianServiceDurationRegressionPercent
    > thresholds.maximumMedianServiceDurationRegressionPercent
  ) {
    blockers.push("service-duration-regressed");
  }
  if (
    pilot.infrastructureFailureRatePercent
    > thresholds.maximumInfrastructureFailureRatePercent
  ) {
    blockers.push("infrastructure-failure-rate-high");
  }

  if (blockers.length > 0) {
    return {
      reportVersion: LOCAL_CI_PILOT_REPORT_VERSION,
      recommendation: "rollback",
      thresholds,
      comparison,
      blockers,
      advisories,
    };
  }

  if (
    baseline.sampleCount < thresholds.minimumSamplesPerWindow
    || pilot.sampleCount < thresholds.minimumSamplesPerWindow
  ) {
    advisories.push("representative-window-too-small");
  }
  if (
    comparison.sampleRatio < thresholds.minimumComparableSampleRatio
    || comparison.sampleRatio > thresholds.maximumComparableSampleRatio
  ) {
    advisories.push("workload-windows-not-comparable");
  }
  if (
    comparison.p95QueueWaitImprovementPercent
    < thresholds.minimumP95QueueWaitImprovementPercent
  ) {
    advisories.push("p95-queue-improvement-not-material");
  }

  return {
    reportVersion: LOCAL_CI_PILOT_REPORT_VERSION,
    recommendation: advisories.length === 0 ? "retain" : "tune",
    thresholds,
    comparison,
    blockers,
    advisories,
  };
}
