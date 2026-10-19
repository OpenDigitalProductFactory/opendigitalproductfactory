/**
 * Controlled-substance discrepancy cases (EP-CSC-CUSTODY, BI-E979538E).
 *
 * Pure. The case lifecycle follows the veterinary design (detection never
 * auto-adjusts the ledger). For suspected theft or significant loss, 21 CFR
 * 1301.76(b) requires written notice to the DEA field office within one
 * business day of discovery and DEA Form 106 within 45 days; a case of that
 * class cannot close until both are evidenced.
 */

import type {
  ControlledSubstanceDiscrepancyClass,
  ControlledSubstanceDiscrepancyStatus,
} from "@dpf/db/controlled-substance-enums";

export const DISCREPANCY_TRANSITIONS: Readonly<
  Record<ControlledSubstanceDiscrepancyStatus, readonly ControlledSubstanceDiscrepancyStatus[]>
> = {
  detected: ["contained", "investigating", "escalated"],
  contained: ["investigating", "escalated"],
  investigating: ["adjustment_approved", "escalated", "reconciled"],
  adjustment_approved: ["reconciled"],
  escalated: ["investigating", "adjustment_approved", "reconciled"],
  reconciled: ["closed"],
  closed: [],
};

export function canTransition(
  from: ControlledSubstanceDiscrepancyStatus,
  to: ControlledSubstanceDiscrepancyStatus,
): boolean {
  return DISCREPANCY_TRANSITIONS[from].includes(to);
}

const REPORTABLE: ReadonlySet<ControlledSubstanceDiscrepancyClass> = new Set(["suspected_theft", "significant_loss"]);

export function requiresLossReporting(classification: ControlledSubstanceDiscrepancyClass): boolean {
  return REPORTABLE.has(classification);
}

/** 21 CFR 1301.76(b)(1)-(6): the factors a reviewer weighs for "significant". */
export const SIGNIFICANCE_FACTORS = [
  { key: "quantity_relative_to_business", label: "Quantity lost relative to the type of business" },
  { key: "specific_substances", label: "The specific controlled substances lost" },
  { key: "attributable_to_individuals", label: "Whether the loss can be tied to particular people or activities" },
  { key: "pattern_over_time", label: "A pattern of losses over time, and whether they appear random" },
  { key: "diversion_likelihood", label: "Whether the substances are likely candidates for diversion" },
  { key: "local_diversion_trends", label: "Local trends and other indicators of diversion potential" },
] as const;

// ─── Deadlines ──────────────────────────────────────────────────────────────

/**
 * Calendar parts of an instant in a timezone. The formatter's locale is left
 * to the runtime default and forced to Latin digits and the Gregorian
 * calendar, because only the numeric parts are read; nothing here is shown
 * to a person.
 */
function zonedParts(instant: Date, timeZone: string): Record<"year" | "month" | "day" | "hour" | "minute" | "second", number> {
  const parts = new Intl.DateTimeFormat(undefined, {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** YYYY-MM-DD in the register's timezone. */
function localDate(instant: Date, timeZone: string): string {
  const { year, month, day } = zonedParts(instant, timeZone);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isWeekend(isoDate: string): boolean {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** UTC offset of a timezone at an instant, in minutes. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** The last millisecond of a local calendar day, as an instant. */
export function endOfLocalDay(isoDate: string, timeZone: string): Date {
  const naive = Date.parse(`${isoDate}T23:59:59.999Z`);
  const offset = offsetMinutes(new Date(naive), timeZone);
  return new Date(naive - offset * 60000);
}

export interface LossReportingDeadlines {
  discoveredOn: string;
  regulatorNoticeDueOn: string;
  regulatorNoticeDueAt: Date;
  lossReportDueOn: string;
  lossReportDueAt: Date;
}

/**
 * Notice is due by the end of the next business day after the discovery date
 * (weekends and the supplied holidays skipped); Form 106 by the end of the
 * 45th calendar day after discovery. Dates are local to the register.
 */
export function lossReportingDeadlines(input: {
  discoveredAt: Date;
  timeZone: string;
  holidays?: readonly string[];
}): LossReportingDeadlines {
  const holidays = new Set(input.holidays ?? []);
  const discoveredOn = localDate(input.discoveredAt, input.timeZone);
  let noticeOn = addDays(discoveredOn, 1);
  while (isWeekend(noticeOn) || holidays.has(noticeOn)) noticeOn = addDays(noticeOn, 1);
  const reportOn = addDays(discoveredOn, 45);
  return {
    discoveredOn,
    regulatorNoticeDueOn: noticeOn,
    regulatorNoticeDueAt: endOfLocalDay(noticeOn, input.timeZone),
    lossReportDueOn: reportOn,
    lossReportDueAt: endOfLocalDay(reportOn, input.timeZone),
  };
}

// ─── Guards ─────────────────────────────────────────────────────────────────

export interface DiscrepancyState {
  status: ControlledSubstanceDiscrepancyStatus;
  classification: ControlledSubstanceDiscrepancyClass;
  classificationRationale: string | null;
  regulatorNoticeGivenAt: Date | null;
  regulatorNoticeRef: string | null;
  lossReportFiledAt: Date | null;
  lossReportRef: string | null;
  resolution: string | null;
}

export type DiscrepancyRefusalCode =
  | "illegal_transition"
  | "rationale_required"
  | "resolution_required"
  | "regulator_notice_missing"
  | "loss_report_missing";

export interface DiscrepancyRefusal {
  code: DiscrepancyRefusalCode;
  message: string;
}

function present(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** Validate a transition to `to` given the case as it would be after the change. */
export function evaluateDiscrepancyTransition(
  from: ControlledSubstanceDiscrepancyStatus,
  to: ControlledSubstanceDiscrepancyStatus,
  next: DiscrepancyState,
): { allowed: true } | { allowed: false; refusals: DiscrepancyRefusal[] } {
  const refusals: DiscrepancyRefusal[] = [];
  if (!canTransition(from, to)) {
    refusals.push({ code: "illegal_transition", message: `A case cannot move from ${from} to ${to}.` });
  }
  if (next.classification !== "unclassified" && !present(next.classificationRationale)) {
    refusals.push({ code: "rationale_required", message: "Record why the case was classified this way." });
  }
  if (to === "escalated" && !requiresLossReporting(next.classification)) {
    refusals.push({
      code: "rationale_required",
      message: "Escalation is for suspected theft or significant loss; classify the case first.",
    });
  }
  if (to === "reconciled" || to === "closed") {
    if (!present(next.resolution)) refusals.push({ code: "resolution_required", message: "Describe how the case was resolved." });
    if (requiresLossReporting(next.classification)) {
      if (!next.regulatorNoticeGivenAt || !present(next.regulatorNoticeRef)) {
        refusals.push({
          code: "regulator_notice_missing",
          message: "Record when and how the DEA field office was notified (21 CFR 1301.76(b)).",
        });
      }
      if (!next.lossReportFiledAt || !present(next.lossReportRef)) {
        refusals.push({ code: "loss_report_missing", message: "Record the DEA Form 106 submission reference." });
      }
    }
  }
  return refusals.length > 0 ? { allowed: false, refusals } : { allowed: true };
}
