import type { Intent } from "@/components/ui/report-kit";

export function moneyToNumber(
  value: number | string | { toString(): string } | null,
): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  const parsed = Number(typeof value === "string" ? value : value.toString());
  return Number.isFinite(parsed) ? parsed : 0;
}

export function titleCase(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

export function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
}

/** Humanize an elapsed duration for a queue-wait chip ("8m", "3h", "2d"). */
export function humanizeWait(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

/** "07-16" — a compact month-day from an ISO date. */
export function monthDay(value: Date): string {
  return value.toISOString().slice(5, 10);
}

export function isWalkInWait(booking: { scheduledAt: Date | null }): boolean {
  return booking.scheduledAt == null;
}

/** State → intent for a resource unit / booking. */
export function statusIntent(status: string): Intent {
  const normalized = status.toLowerCase();
  if (["active", "confirmed", "completed", "paid", "healthy"].some((value) => normalized.includes(value))) return "success";
  if (["pending", "scheduled", "in_progress", "inprogress", "onboarding"].some((value) => normalized.includes(value))) return "info";
  if (["overdue", "failed", "at_risk", "at-risk", "blocked", "cancelled"].some((value) => normalized.includes(value))) return "danger";
  if (["hold", "review", "draft", "stale", "watch"].some((value) => normalized.includes(value))) return "warning";
  return "neutral";
}
