/**
 * Controlled-substance count rules (EP-CSC-CUSTODY, BI-CSC-003).
 *
 * Pure. 21 CFR 1304.11: an initial inventory, then a new one at least every two
 * years; an exact count for Schedule I/II; an estimate is allowed for an opened
 * Schedule III-V container unless it holds more than 1,000 units. A non-zero
 * variance opens a discrepancy and never adjusts the ledger by itself.
 */

import type {
  ControlledSubstanceCountKind,
  ControlledSubstanceCountMethod,
  ControlledSubstanceSchedule,
} from "@dpf/db/controlled-substance-enums";

import { holdsScope, isEligibleHandler, type HandlerGrant, type PrincipalFacts } from "./ledger-policy";
import { formatQuantity, parseQuantity, type Quantity } from "./quantity";

const EXACT_ONLY_SCHEDULES: ReadonlySet<ControlledSubstanceSchedule> = new Set(["c_i", "c_ii", "c_ii_n"]);
const ESTIMATE_CONTAINER_LIMIT = parseQuantity("1000");

export type MethodRequirement = "exact" | "exact_or_estimated";

export function requiredCountMethod(input: {
  schedule: ControlledSubstanceSchedule;
  openedContainer: boolean;
  containerUnits: Quantity | null;
}): MethodRequirement {
  if (EXACT_ONLY_SCHEDULES.has(input.schedule)) return "exact";
  if (!input.openedContainer) return "exact";
  if (input.containerUnits !== null && input.containerUnits > ESTIMATE_CONTAINER_LIMIT) return "exact";
  return "exact_or_estimated";
}

export type CountRefusalCode =
  | "no_lines"
  | "duplicate_product"
  | "negative_count"
  | "estimate_not_permitted"
  | "taker_not_human"
  | "taker_not_authorized"
  | "witness_is_taker"
  | "witness_not_human"
  | "witness_not_authorized"
  | "witness_required";

export interface CountRefusal {
  code: CountRefusalCode;
  message: string;
  productId?: string;
}

export interface CountLineProposal {
  productId: string;
  productName: string;
  schedule: ControlledSubstanceSchedule;
  method: ControlledSubstanceCountMethod;
  openedContainer: boolean;
  containerUnits: Quantity | null;
  expected: Quantity;
  counted: Quantity;
}

export interface EvaluatedCountLine {
  productId: string;
  method: ControlledSubstanceCountMethod;
  expected: Quantity;
  counted: Quantity;
  variance: Quantity;
}

export type CountEvaluation =
  | { allowed: true; lines: EvaluatedCountLine[]; variances: EvaluatedCountLine[] }
  | { allowed: false; refusals: CountRefusal[] };

export function evaluateCount(input: {
  kind: ControlledSubstanceCountKind;
  takenAt: Date;
  taker: PrincipalFacts;
  witness: PrincipalFacts | null;
  /** Policy overlay (for example a state rule or a shelter's own SOP). */
  witnessRequired: boolean;
  grants: readonly HandlerGrant[];
  lines: readonly CountLineProposal[];
}): CountEvaluation {
  const refusals: CountRefusal[] = [];
  const refuse = (code: CountRefusalCode, message: string, productId?: string) =>
    refusals.push({ code, message, ...(productId ? { productId } : {}) });

  if (!isEligibleHandler(input.taker)) {
    refuse("taker_not_human", "Only an active staff member can take a controlled-substance count.");
  } else if (!holdsScope(input.grants, input.taker.id, "count", input.takenAt)) {
    refuse("taker_not_authorized", "You are not authorized to count this register at that time.");
  }
  if (input.witnessRequired && !input.witness) refuse("witness_required", "A second authorized person must witness this count.");
  if (input.witness) {
    if (input.witness.id === input.taker.id) refuse("witness_is_taker", "The witness must be a different person.");
    else if (!isEligibleHandler(input.witness)) refuse("witness_not_human", "The witness must be an active staff member.");
    else if (!holdsScope(input.grants, input.witness.id, "witness", input.takenAt)) {
      refuse("witness_not_authorized", "The witness is not authorized to witness on this register at that time.");
    }
  }

  if (input.lines.length === 0) refuse("no_lines", "A count needs at least one product line.");
  const seen = new Set<string>();
  const evaluated: EvaluatedCountLine[] = [];
  for (const line of input.lines) {
    if (seen.has(line.productId)) refuse("duplicate_product", `${line.productName} is listed twice.`, line.productId);
    seen.add(line.productId);
    if (line.counted < 0n) refuse("negative_count", `${line.productName}: a count cannot be negative.`, line.productId);
    if (line.method === "estimated" && requiredCountMethod(line) === "exact") {
      refuse(
        "estimate_not_permitted",
        `${line.productName}: this schedule or container size needs an exact count.`,
        line.productId,
      );
    }
    evaluated.push({
      productId: line.productId,
      method: line.method,
      expected: line.expected,
      counted: line.counted,
      variance: line.counted - line.expected,
    });
  }

  if (refusals.length > 0) return { allowed: false, refusals };
  return { allowed: true, lines: evaluated, variances: evaluated.filter((line) => line.variance !== 0n) };
}

// ─── Due dates ──────────────────────────────────────────────────────────────

export interface CountHistoryEntry {
  kind: ControlledSubstanceCountKind;
  takenAt: Date;
}

export type CountDue =
  | { kind: "initial"; dueAt: null; overdue: true; reason: string }
  | { kind: "biennial"; dueAt: Date; overdue: boolean; reason: string };

function addYears(date: Date, years: number): Date {
  const next = new Date(date.getTime());
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}

/**
 * The next federally required count for a register. Biennial counts run from
 * the latest initial or biennial count; other count kinds do not reset it.
 */
export function nextCountDue(history: readonly CountHistoryEntry[], now: Date): CountDue {
  const anchors = history.filter((entry) => entry.kind === "initial" || entry.kind === "biennial");
  if (anchors.length === 0) {
    return { kind: "initial", dueAt: null, overdue: true, reason: "No initial inventory is recorded for this register." };
  }
  const latest = anchors.reduce((a, b) => (a.takenAt.getTime() >= b.takenAt.getTime() ? a : b));
  const dueAt = addYears(latest.takenAt, 2);
  return {
    kind: "biennial",
    dueAt,
    overdue: now.getTime() > dueAt.getTime(),
    reason: `Two years after the ${latest.kind} inventory of ${latest.takenAt.toISOString().slice(0, 10)}.`,
  };
}

export function describeVariance(line: EvaluatedCountLine): string {
  return `expected ${formatQuantity(line.expected)}, counted ${formatQuantity(line.counted)}, variance ${formatQuantity(line.variance)}`;
}
