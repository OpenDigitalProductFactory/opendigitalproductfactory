// Universal Grid & Workbooks — formula function registry (EP-GRID-WORKBOOKS, Phase 2)
//
// The v1 function set from the hybrid-SoR design spec, implemented as plain,
// synchronous, row-local functions (no range/aggregation-over-rows — those need
// the full dataset + push-down and are a reporting-phase concern). Every function
// is pure and side-effect-free; the evaluator only ever calls names that appear
// in this registry, so a formula can never invoke arbitrary code.

export type FormulaValue = string | number | boolean | null;

export class FormulaError extends Error {}

// ── coercion helpers ────────────────────────────────────────────────────────

export function toNumber(v: FormulaValue): number {
  if (v === null || v === "") return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) throw new FormulaError(`Expected a number, got "${String(v)}"`);
  return n;
}

export function toStr(v: FormulaValue): string {
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}

export function toBool(v: FormulaValue): boolean {
  if (typeof v === "boolean") return v;
  if (v === null || v === "" || v === 0) return false;
  if (typeof v === "string") return v.toLowerCase() !== "false" && v !== "";
  return Boolean(v);
}

function toDate(v: FormulaValue): Date {
  const d = new Date(typeof v === "number" ? v : String(v ?? ""));
  if (Number.isNaN(d.getTime())) throw new FormulaError(`Expected a date, got "${String(v)}"`);
  return d;
}

const DAY_MS = 86_400_000;

export type FormulaFn = (args: FormulaValue[]) => FormulaValue;

// ── the registry ────────────────────────────────────────────────────────────

export const FORMULA_FUNCTIONS: Record<string, FormulaFn> = {
  // Logical
  IF: (a) => (toBool(a[0]) ? a[1] ?? null : a[2] ?? null),
  IFS: (a) => {
    for (let i = 0; i + 1 < a.length; i += 2) {
      if (toBool(a[i])) return a[i + 1] ?? null;
    }
    return null;
  },
  AND: (a) => a.every((v) => toBool(v)),
  OR: (a) => a.some((v) => toBool(v)),
  NOT: (a) => !toBool(a[0]),
  SWITCH: (a) => {
    const subject = a[0] ?? null;
    for (let i = 1; i + 1 < a.length; i += 2) {
      if (toStr(a[i]) === toStr(subject)) return a[i + 1] ?? null;
    }
    // trailing odd arg = default
    return a.length % 2 === 0 ? a[a.length - 1] ?? null : null;
  },

  // Math / stats (over the literal args, not column ranges)
  SUM: (a) => a.reduce<number>((s, v) => s + toNumber(v), 0),
  AVERAGE: (a) => (a.length ? a.reduce<number>((s, v) => s + toNumber(v), 0) / a.length : 0),
  MIN: (a) => Math.min(...a.map(toNumber)),
  MAX: (a) => Math.max(...a.map(toNumber)),
  COUNT: (a) => a.filter((v) => v !== null && v !== "" && !Number.isNaN(Number(v))).length,
  ROUND: (a) => {
    const f = 10 ** (a[1] === undefined ? 0 : toNumber(a[1]));
    return Math.round(toNumber(a[0]) * f) / f;
  },
  FLOOR: (a) => {
    const s = a[1] === undefined ? 1 : toNumber(a[1]);
    return Math.floor(toNumber(a[0]) / s) * s;
  },
  CEILING: (a) => {
    const s = a[1] === undefined ? 1 : toNumber(a[1]);
    return Math.ceil(toNumber(a[0]) / s) * s;
  },
  ABS: (a) => Math.abs(toNumber(a[0])),

  // Text
  CONCAT: (a) => a.map(toStr).join(""),
  CONCATENATE: (a) => a.map(toStr).join(""),
  TEXT: (a) => toStr(a[0]),
  LEFT: (a) => toStr(a[0]).slice(0, a[1] === undefined ? 1 : toNumber(a[1])),
  RIGHT: (a) => {
    const n = a[1] === undefined ? 1 : toNumber(a[1]);
    return n <= 0 ? "" : toStr(a[0]).slice(-n);
  },
  MID: (a) => {
    const start = Math.max(0, toNumber(a[1]) - 1);
    return toStr(a[0]).slice(start, start + toNumber(a[2]));
  },
  LEN: (a) => toStr(a[0]).length,
  TRIM: (a) => toStr(a[0]).trim(),
  SUBSTITUTE: (a) => toStr(a[0]).split(toStr(a[1])).join(toStr(a[2])),
  LOWER: (a) => toStr(a[0]).toLowerCase(),
  UPPER: (a) => toStr(a[0]).toUpperCase(),

  // Date / time
  TODAY: () => new Date().toISOString().slice(0, 10),
  NOW: () => new Date().toISOString(),
  YEAR: (a) => toDate(a[0]).getUTCFullYear(),
  MONTH: (a) => toDate(a[0]).getUTCMonth() + 1,
  DAY: (a) => toDate(a[0]).getUTCDate(),
  DATEDIF: (a) => {
    const start = toDate(a[0]).getTime();
    const end = toDate(a[1]).getTime();
    const unit = toStr(a[2]).toUpperCase();
    const days = Math.floor((end - start) / DAY_MS);
    if (unit === "D") return days;
    if (unit === "M") return Math.floor(days / 30);
    if (unit === "Y") return Math.floor(days / 365);
    throw new FormulaError(`DATEDIF unit must be D, M, or Y (got "${unit}")`);
  },
  EOMONTH: (a) => {
    const d = toDate(a[0]);
    const months = a[1] === undefined ? 0 : toNumber(a[1]);
    const eom = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months + 1, 0));
    return eom.toISOString().slice(0, 10);
  },
};

export function isFormulaFunction(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(FORMULA_FUNCTIONS, name.toUpperCase());
}
