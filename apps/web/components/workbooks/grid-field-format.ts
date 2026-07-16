// Universal Grid & Workbooks — display formatting for the numeric/text-backed
// field types (rating, percent, currency, progress, duration, phone). Pure +
// unit-testable; the React renderers in cell-editors.tsx call these.

/** Coerce a cell value to a finite number, or null. */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Group a number's integer part with thousands separators, keeping `precision` decimals. */
function groupNumber(n: number, precision: number): string {
  const fixed = n.toFixed(precision);
  const [intPart, dec] = fixed.split(".");
  const sign = intPart.startsWith("-") ? "-" : "";
  const digits = sign ? intPart.slice(1) : intPart;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dec ? `${sign}${grouped}.${dec}` : `${sign}${grouped}`;
}

/** "$1,234.50" — symbol prefix, thousands-grouped, `precision` decimals (default 2). */
export function formatCurrency(value: unknown, symbol = "$", precision = 2): string {
  const n = toNumber(value);
  if (n === null) return "";
  return `${symbol}${groupNumber(n, precision)}`;
}

/** "50%" — the stored number is the percent itself (50 → 50%), `precision` decimals (default 0). */
export function formatPercent(value: unknown, precision = 0): string {
  const n = toNumber(value);
  if (n === null) return "";
  return `${groupNumber(n, precision)}%`;
}

/**
 * "2h 30m" from a duration stored in `unit` (minutes by default). Sub-minute
 * seconds render as "45s"; zero renders "0m". Negative values are clamped to 0.
 */
export function formatDuration(value: unknown, unit: "minutes" | "seconds" = "minutes"): string {
  const raw = toNumber(value);
  if (raw === null) return "";
  const totalSeconds = Math.max(0, Math.round(unit === "seconds" ? raw : raw * 60));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 && h === 0) parts.push(`${s}s`);
  return parts.length > 0 ? parts.join(" ") : "0m";
}

/** Clamp a rating to an integer in [0, max]. */
export function clampRating(value: unknown, max = 5): number {
  const n = toNumber(value);
  if (n === null) return 0;
  return Math.max(0, Math.min(Math.round(n), Math.max(1, Math.round(max))));
}

/** The filled/empty star split for a rating. */
export function ratingStars(value: unknown, max = 5): { filled: number; total: number } {
  const total = Math.max(1, Math.round(max));
  return { filled: clampRating(value, total), total };
}

/** Clamp a progress value to [0, 100]. */
export function clampProgress(value: unknown): number {
  const n = toNumber(value);
  if (n === null) return 0;
  return Math.max(0, Math.min(100, n));
}
