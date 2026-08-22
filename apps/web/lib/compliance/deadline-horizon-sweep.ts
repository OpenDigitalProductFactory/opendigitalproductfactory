// apps/web/lib/compliance/deadline-horizon-sweep.ts
//
// The `deadline-horizon` trigger (TAK §8.11.1) for the obligation-assurance-watch
// work shape.
//
// Six columns recorded a recurring intention and nothing read any of them:
//   Obligation.frequency
//   Control.reviewFrequency, Control.nextReviewDate, Control.lastReviewedAt
//   LicenseRequirementReference.staleAfterDays, .renewalCadenceHint
// §8.11.1: "A recorded intention that no trigger consumes SHOULD be treated as a
// defect rather than as latent configuration. Such a field reads to an operator
// as a control that is in force, and behaves as one that is not." This is the
// reader that makes them in force.
//
// Deliberately a PURE function over already-loaded rows. It asks no model and
// invents no obligations: every finding traces to a recorded date or a recorded
// recurrence, and the evidence payload names which column produced it. The
// runner (deadline-horizon-runner.ts) does the I/O.

import { createFindingKey, normalizeVendorIdentifier } from "@/lib/assurance/finding-key";
import { classifyObligationFrequency } from "./obligation-cadence";
import type {
  AssurancePolicySeverity,
  NormalizedAssuranceFinding,
} from "@/lib/assurance/types";

export const DEADLINE_HORIZON_ADAPTER_KEY = "compliance-deadline-horizon";
export const DEADLINE_HORIZON_ADAPTER_VERSION = "1.0.0";

/** Default look-ahead. An obligation is worth raising before it is late, not after. */
export const DEFAULT_HORIZON_DAYS = 30;

/** Stop condition (budget) declared on the shape — a run never buries the ledger. */
export const MAX_FINDINGS_PER_RUN = 200;

const DAY_MS = 86_400_000;

export type { ObligationTriggerClass } from "./obligation-cadence";

export type SweepObligation = {
  obligationId: string;
  title: string;
  frequency: string | null;
  reviewDate: Date | null;
  status: string;
};

export type SweepControl = {
  controlId: string;
  title: string;
  reviewFrequency: string | null;
  lastReviewedAt: Date | null;
  nextReviewDate: Date | null;
  status: string;
};

export type SweepLicenseReference = {
  requirementRefId: string;
  jurisdictionLabel: string;
  requirementType: string;
  staleAfterDays: number;
  renewalCadenceHint: string | null;
  lastVerifiedAt: Date | null;
};

export type DeadlineHorizonInput = {
  now: Date;
  horizonDays?: number;
  obligations: readonly SweepObligation[];
  controls: readonly SweepControl[];
  licenseReferences: readonly SweepLicenseReference[];
};

export type DeadlineHorizonResult = {
  findings: NormalizedAssuranceFinding[];
  /** Non-null when a declared stop condition ended the run early. */
  stoppedBy: { kind: "failure" | "budget"; reason: string } | null;
  scanned: { obligations: number; controls: number; licenseReferences: number };
  horizonDays: number;
};

type Reason =
  | "due-inside-horizon"
  | "overdue"
  | "recurrence-with-no-next-date"
  | "uncomputable-frequency"
  | "evidence-stale";

/** Overdue is high; inside the horizon is medium; an unreadable recurrence is low but visible. */
function severityFor(reason: Reason): AssurancePolicySeverity {
  if (reason === "overdue") return "high";
  if (reason === "due-inside-horizon" || reason === "evidence-stale") return "medium";
  return "low";
}

/** Re-exported so callers share one vocabulary rather than re-deriving days. */
export { cadenceToDays } from "./obligation-cadence";

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

function finding(input: {
  affectedId: string;
  vendorIdentifier: string;
  title: string;
  description: string;
  reason: Reason;
  evidence: Record<string, unknown>;
  remediationHint: Record<string, unknown>;
}): NormalizedAssuranceFinding {
  // Stable across runs so one due date reopens rather than duplicating.
  const { identifier, stability } = normalizeVendorIdentifier(
    input.vendorIdentifier,
    input.title,
  );
  const keyInput = {
    adapterKey: DEADLINE_HORIZON_ADAPTER_KEY,
    findingKind: "obligation-deadline" as const,
    affectedType: "compliance-record" as const,
    affectedId: input.affectedId,
    vendorIdentifier: identifier,
  };
  return {
    ...keyInput,
    findingKey: createFindingKey(keyInput),
    title: input.title,
    description: input.description,
    sourceSeverity: input.reason,
    policySeverity: severityFor(input.reason),
    // Compliance deadlines do not block a software release; they are tracked
    // and escalated on their own review point.
    releaseImpact: "track",
    reachability: "unknown",
    exposure: "internal",
    identifierStability: stability,
    evidence: { ...input.evidence, reason: input.reason },
    remediationHint: input.remediationHint,
  };
}

/**
 * Pure sweep. Returns one finding per record inside (or past) the horizon.
 * An empty substrate is a FAILURE stop, never "nothing due" — the difference
 * between a clean sweep and an unread one is the whole point of the review.
 */
export function sweepDeadlineHorizon(input: DeadlineHorizonInput): DeadlineHorizonResult {
  const horizonDays = input.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const now = input.now;
  const horizonEnd = new Date(now.getTime() + horizonDays * DAY_MS);
  const scanned = {
    obligations: input.obligations.length,
    controls: input.controls.length,
    licenseReferences: input.licenseReferences.length,
  };

  if (scanned.obligations + scanned.controls + scanned.licenseReferences === 0) {
    return {
      findings: [],
      stoppedBy: {
        kind: "failure",
        reason:
          "No obligations, controls, or licence references are recorded — the sweep read an empty "
          + "compliance substrate. It reports rather than concluding that nothing is due.",
      },
      scanned,
      horizonDays,
    };
  }

  const findings: NormalizedAssuranceFinding[] = [];

  // ── Obligation.frequency + reviewDate ──────────────────────────────────────
  for (const obligation of input.obligations) {
    if (obligation.status !== "active") continue;
    const cadence = classifyObligationFrequency(obligation.frequency);
    const cadenceDays = cadence.periodDays;

    if (obligation.reviewDate) {
      if (obligation.reviewDate > horizonEnd) continue;
      const overdue = obligation.reviewDate < now;
      findings.push(finding({
        affectedId: `obligation:${obligation.obligationId}`,
        vendorIdentifier: `obligation:${obligation.obligationId}:${obligation.reviewDate.toISOString().slice(0, 10)}`,
        title: `${overdue ? "Overdue" : "Due"}: ${obligation.title}`,
        description:
          `Obligation ${obligation.obligationId} has a recorded review date of `
          + `${obligation.reviewDate.toISOString().slice(0, 10)} `
          + `(${overdue ? `${Math.abs(daysBetween(now, obligation.reviewDate))} days ago` : `in ${daysBetween(now, obligation.reviewDate)} days`})`
          + `${obligation.frequency ? `, recurring ${obligation.frequency}` : ""}.`,
        reason: overdue ? "overdue" : "due-inside-horizon",
        evidence: {
          source: "Obligation.reviewDate",
          obligationId: obligation.obligationId,
          reviewDate: obligation.reviewDate.toISOString(),
          frequency: obligation.frequency,
          horizonDays,
        },
        remediationHint: {
          action: "Complete the review and record the next review date.",
          nextReviewDate: cadenceDays
            ? new Date(obligation.reviewDate.getTime() + cadenceDays * DAY_MS).toISOString()
            : null,
        },
      }));
      continue;
    }

    // ONLY a genuine recurrence needs an anchor date. `continuous` (a standing
    // control, in force every day) and `event-driven` (started by an occurrence)
    // are CORRECTLY dateless — reporting them was 88 of the first live sweep's
    // 141 findings, every one of them false.
    if (cadence.requiresAnchorDate) {
      findings.push(finding({
        affectedId: `obligation:${obligation.obligationId}`,
        vendorIdentifier: `obligation:${obligation.obligationId}:no-next-date`,
        title: `Recurring obligation with no next date: ${obligation.title}`,
        description:
          `Obligation ${obligation.obligationId} recurs ${obligation.frequency} and has no review `
          + "date, so nothing will ever fall due. The recurrence reads as a control in force and "
          + "is not.",
        reason: "recurrence-with-no-next-date",
        evidence: {
          source: "Obligation.frequency",
          obligationId: obligation.obligationId,
          frequency: obligation.frequency,
          triggerClass: cadence.triggerClass,
          periodDays: cadenceDays,
          reviewDate: null,
        },
        remediationHint: {
          action: "Set the review date this obligation next falls due.",
          suggestedReviewDate: cadenceDays
            ? new Date(now.getTime() + cadenceDays * DAY_MS).toISOString()
            : null,
        },
      }));
      continue;
    }

    // Words are recorded and mean something to a person, but nothing can turn
    // them into a date. Reported as its own low finding rather than guessed at
    // — a fabricated due date in front of a compliance owner is worse than a
    // missing one.
    if (cadence.triggerClass === "unrecognised") {
      findings.push(finding({
        affectedId: `obligation:${obligation.obligationId}`,
        vendorIdentifier: `obligation:${obligation.obligationId}:uncomputable-frequency`,
        title: `Frequency nothing can compute: ${obligation.title}`,
        description:
          `Obligation ${obligation.obligationId} records a frequency of "${obligation.frequency}", `
          + "which is neither a recognised recurrence nor a declared standing or event-driven "
          + "obligation. Nothing can derive a date from it, so it is watched by nothing.",
        reason: "uncomputable-frequency",
        evidence: {
          source: "Obligation.frequency",
          obligationId: obligation.obligationId,
          frequency: obligation.frequency,
          triggerClass: cadence.triggerClass,
          reviewDate: null,
        },
        remediationHint: {
          action:
            "Record a recognised recurrence (e.g. quarterly, annual), or declare the obligation "
            + "continuous or event-driven if it is not on a schedule.",
          suggestedReviewDate: null,
        },
      }));
    }
  }

  // ── Control.reviewFrequency / nextReviewDate / lastReviewedAt ──────────────
  for (const control of input.controls) {
    if (control.status !== "active") continue;
    const controlCadence = classifyObligationFrequency(control.reviewFrequency);
    const cadenceDays = controlCadence.periodDays;

    // nextReviewDate wins; otherwise derive it from lastReviewedAt + cadence.
    const derivedFrom = control.nextReviewDate
      ? "Control.nextReviewDate"
      : control.lastReviewedAt && cadenceDays
        ? "Control.lastReviewedAt + Control.reviewFrequency"
        : null;
    const due = control.nextReviewDate
      ?? (control.lastReviewedAt && cadenceDays
        ? new Date(control.lastReviewedAt.getTime() + cadenceDays * DAY_MS)
        : null);

    if (due && derivedFrom) {
      if (due > horizonEnd) continue;
      const overdue = due < now;
      findings.push(finding({
        affectedId: `control:${control.controlId}`,
        vendorIdentifier: `control:${control.controlId}:${due.toISOString().slice(0, 10)}`,
        title: `${overdue ? "Overdue control review" : "Control review due"}: ${control.title}`,
        description:
          `Control ${control.controlId} is due for review on ${due.toISOString().slice(0, 10)} `
          + `(${overdue ? `${Math.abs(daysBetween(now, due))} days ago` : `in ${daysBetween(now, due)} days`}), `
          + `derived from ${derivedFrom}.`,
        reason: overdue ? "overdue" : "due-inside-horizon",
        evidence: {
          source: derivedFrom,
          controlId: control.controlId,
          reviewFrequency: control.reviewFrequency,
          lastReviewedAt: control.lastReviewedAt?.toISOString() ?? null,
          nextReviewDate: control.nextReviewDate?.toISOString() ?? null,
          dueAt: due.toISOString(),
          horizonDays,
        },
        remediationHint: {
          action: "Review the control, record lastReviewedAt, and set the next review date.",
          nextReviewDate: cadenceDays
            ? new Date(due.getTime() + cadenceDays * DAY_MS).toISOString()
            : null,
        },
      }));
      continue;
    }

    // Same rule as obligations: only a real recurrence needs a date. A control
    // declared continuous is operating every day, not overdue for review.
    if (controlCadence.requiresAnchorDate) {
      findings.push(finding({
        affectedId: `control:${control.controlId}`,
        vendorIdentifier: `control:${control.controlId}:no-next-date`,
        title: `Control declares a review cadence but has never been reviewed: ${control.title}`,
        description:
          `Control ${control.controlId} is reviewed ${control.reviewFrequency} and has neither a `
          + "last-reviewed date nor a next-review date, so no review will ever fall due.",
        reason: "recurrence-with-no-next-date",
        evidence: {
          source: "Control.reviewFrequency",
          controlId: control.controlId,
          reviewFrequency: control.reviewFrequency,
          triggerClass: controlCadence.triggerClass,
          lastReviewedAt: null,
          nextReviewDate: null,
        },
        remediationHint: {
          action: "Record the last review, or set the next review date.",
          suggestedReviewDate: cadenceDays
            ? new Date(now.getTime() + cadenceDays * DAY_MS).toISOString()
            : null,
        },
      }));
    }
  }

  // ── LicenseRequirementReference.staleAfterDays / renewalCadenceHint ────────
  for (const reference of input.licenseReferences) {
    const staleAfterDays = reference.staleAfterDays;
    if (!(staleAfterDays > 0)) continue;
    // Never verified is stale by definition — that is evidence decay at its limit.
    const staleAt = reference.lastVerifiedAt
      ? new Date(reference.lastVerifiedAt.getTime() + staleAfterDays * DAY_MS)
      : now;
    if (staleAt > horizonEnd) continue;
    findings.push(finding({
      affectedId: `license-requirement:${reference.requirementRefId}`,
      vendorIdentifier: `license-requirement:${reference.requirementRefId}:${staleAt.toISOString().slice(0, 10)}`,
      title: `Licence requirement evidence goes stale: ${reference.jurisdictionLabel} — ${reference.requirementType}`,
      description: reference.lastVerifiedAt
        ? `Requirement ${reference.requirementRefId} was last verified on `
          + `${reference.lastVerifiedAt.toISOString().slice(0, 10)} and goes stale after `
          + `${staleAfterDays} days, i.e. ${staleAt.toISOString().slice(0, 10)}.`
        : `Requirement ${reference.requirementRefId} has never been verified, so its `
          + `${staleAfterDays}-day freshness budget is already spent.`,
      reason: "evidence-stale",
      evidence: {
        source: "LicenseRequirementReference.staleAfterDays",
        requirementRefId: reference.requirementRefId,
        staleAfterDays,
        lastVerifiedAt: reference.lastVerifiedAt?.toISOString() ?? null,
        staleAt: staleAt.toISOString(),
        renewalCadenceHint: reference.renewalCadenceHint,
        horizonDays,
      },
      remediationHint: {
        action: "Re-verify the requirement against the issuing authority and record lastVerifiedAt.",
        renewalCadenceHint: reference.renewalCadenceHint,
      },
    }));
  }

  if (findings.length > MAX_FINDINGS_PER_RUN) {
    return {
      findings: findings.slice(0, MAX_FINDINGS_PER_RUN),
      stoppedBy: {
        kind: "budget",
        reason:
          `The sweep produced ${findings.length} findings, over the ${MAX_FINDINGS_PER_RUN} declared `
          + "on the shape. It reports the first batch and escalates rather than burying the ledger.",
      },
      scanned,
      horizonDays,
    };
  }

  return { findings, stoppedBy: null, scanned, horizonDays };
}
