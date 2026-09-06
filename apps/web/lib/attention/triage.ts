// Triage & prioritization — the pure ordering for the Attention Surface.
// Spec: docs/superpowers/specs/2026-06-23-human-attention-surface-design.md §4.4.
//
// Integrity rule (the scorability caveat applied to RANKING): there is NO single
// composite "priority" number. Incommensurable items are made comparable by the
// SAME objective factors and ordered by a TRANSPARENT TIERED RULE, so every
// position is explainable in one line. A fabricated cross-axis 0.73 would be the
// #2315 0.000-theater in a precise-looking costume — forbidden.
//
// Tiered order:
//   override tier (hard-deadline-imminent OR irreversible-high-risk, shown with reason)
//     → time-to-act → risk → blast-radius (blocked?) → age (FIFO)
//
// Mirrors the paused-work plan's proven shape ("high-risk → bounded-write → read,
// FIFO within tier") and the command-center SEVERITY_RANK / ATTENTION_RANK idiom.

import type {
  AttentionItem,
  AttentionRiskClass,
  AttentionSource,
  DecideEffort,
  ResidueReason,
  TimeToAct,
} from "./types";

// ─── Ranks (lower sorts first) ───────────────────────────────────────────────

const TIME_RANK: Record<TimeToAct, number> = {
  overdue: 0,
  "due-today": 1,
  "due-soon": 2,
  none: 3,
};

const RISK_RANK: Record<AttentionRiskClass, number> = {
  "high-risk": 0,
  "bounded-write": 1,
  read: 2,
  unknown: 3,
};

/** The narrow override set: a hard deadline is imminent, OR the action is
 *  irreversible AND high-risk. These float above the tiered order — and the UI
 *  must show WHY (never a silent jump). Pure. */
export function isOverrideTier(item: AttentionItem): boolean {
  const deadlineImminent = item.triage.timeToAct === "overdue" || item.triage.timeToAct === "due-today";
  const irreversibleHighRisk = item.riskClass === "high-risk" && item.triage.irreversible;
  return deadlineImminent || irreversibleHighRisk;
}

/** The one-line reason an item is in the override tier, for the "pinned to top: …"
 *  affordance. Null when the item is not an override. Pure. */
export function overrideReason(item: AttentionItem): string | null {
  if (!isOverrideTier(item)) return null;
  if (item.triage.timeToAct === "overdue") return "deadline passed";
  if (item.triage.timeToAct === "due-today") return "deadline today";
  return "irreversible, high-risk";
}

// ─── Comparator ──────────────────────────────────────────────────────────────

/** Total-order comparator over attention items. Pure and deterministic — the age
 *  tie-break uses the stored ISO string, never the wall clock. Sort a COPY. */
export function compareAttention(a: AttentionItem, b: AttentionItem): number {
  // Override tier first.
  const ao = isOverrideTier(a) ? 0 : 1;
  const bo = isOverrideTier(b) ? 0 : 1;
  if (ao !== bo) return ao - bo;

  // Time-to-act tier.
  const at = TIME_RANK[a.triage.timeToAct];
  const bt = TIME_RANK[b.triage.timeToAct];
  if (at !== bt) return at - bt;

  // Risk within tier.
  const ar = RISK_RANK[a.riskClass];
  const br = RISK_RANK[b.riskClass];
  if (ar !== br) return ar - br;

  // Blast radius: something blocked sorts before nothing blocked.
  const ab = a.triage.blastRadius ? 0 : 1;
  const bb = b.triage.blastRadius ? 0 : 1;
  if (ab !== bb) return ab - bb;

  // Age: oldest first (FIFO). Lexicographic ISO compare == chronological.
  if (a.createdAtIso !== b.createdAtIso) return a.createdAtIso < b.createdAtIso ? -1 : 1;

  // Stable final tiebreak so the order is fully deterministic across sources.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Order a list of attention items by the tiered rule. Returns a new array. */
export function orderAttention(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort(compareAttention);
}

// ─── Explainability ──────────────────────────────────────────────────────────

const RESIDUE_LABEL: Record<ResidueReason, string> = {
  "coverage-gap": "the kernel had no applicable principle",
  "principle-conflict": "principles conflict on this call",
  "high-risk-gate": "policy requires an employee for this risk",
  "self-fix-exhausted": "Build Studio could not self-repair",
  "input-required": "a coworker needs your input to continue",
  "room-stalled": "a room keeps refusing to advance and needs an accountable owner",
  "needs-credential": "a credential or authority is missing",
  "policy-approval": "an agent action is awaiting your approval",
  "new-memory-note": "a coworker gained a new working-memory note",
  "no-self-heal": "a platform service is degraded and cannot repair itself",
};

/** Human label for the residue reason — the honest "why it's here" line. Pure. */
export function residueReasonLabel(reason: ResidueReason): string {
  return RESIDUE_LABEL[reason];
}

const RISK_LABEL: Record<AttentionRiskClass, string> = {
  "high-risk": "High risk",
  "bounded-write": "Bounded write",
  read: "Read-only",
  unknown: "Unclassified risk",
};

export function riskLabel(risk: AttentionRiskClass): string {
  return RISK_LABEL[risk];
}

const EFFORT_LABEL: Record<DecideEffort, string> = {
  "one-tap": "one tap",
  review: "quick review",
  judgment: "your judgment",
};

export function decideEffortLabel(effort: DecideEffort): string {
  return EFFORT_LABEL[effort];
}

/** A single explainable sentence for WHY an item sits where it does — the
 *  legibility the founder needs to trust (or override) the order. Pure. */
export function orderReason(item: AttentionItem): string {
  const parts: string[] = [];
  const override = overrideReason(item);
  if (override) parts.push(`pinned to top: ${override}`);
  if (item.triage.timeToAct !== "none" && !override) {
    parts.push(item.triage.timeToAct.replace("-", " "));
  }
  if (item.riskClass === "high-risk") parts.push("high risk");
  if (item.triage.blastRadius) parts.push(`blocks ${item.triage.blastRadius}`);
  if (parts.length === 0) parts.push(residueReasonLabel(item.triage.residueReason));
  return parts.join(" · ");
}

/** Compact relative age, now injected for purity (mirrors escalation-attention.ts). */
export function attentionAgeLabel(iso: string, nowMs: number): string {
  const ms = nowMs - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Deadline → time-to-act tier ─────────────────────────────────────────────

/** Map an optional hard deadline to the objective time-to-act tier. `dueSoonH`
 *  (default 24h) is the override window for "due-today". Pure (now injected). */
export function timeToActFromDeadline(
  deadlineIso: string | null | undefined,
  nowMs: number,
  dueSoonH = 24,
): TimeToAct {
  if (!deadlineIso) return "none";
  const due = new Date(deadlineIso).getTime();
  if (!Number.isFinite(due)) return "none";
  const hoursLeft = (due - nowMs) / 3_600_000;
  if (hoursLeft < 0) return "overdue";
  if (hoursLeft <= dueSoonH) return "due-today";
  if (hoursLeft <= dueSoonH * 7) return "due-soon";
  return "none";
}

// ─── At-a-glance summary (the lightweight reviewer-of-evidence overview) ──────

export type AttentionSummary = {
  total: number;
  /** Items in the override tier — the "act first" count. */
  pinned: number;
  highRisk: number;
  /** Per-source counts, highest first, for the grouped overview chips. */
  bySource: { source: AttentionSource; count: number }[];
};

/** Summarize the queue for the overview header. Counts only — no composite score.
 *  Pure (override membership is computed from the item's own factors). */
export function summarizeAttention(items: AttentionItem[]): AttentionSummary {
  const counts = new Map<AttentionSource, number>();
  let pinned = 0;
  let highRisk = 0;
  for (const item of items) {
    counts.set(item.source, (counts.get(item.source) ?? 0) + 1);
    if (isOverrideTier(item)) pinned += 1;
    if (item.riskClass === "high-risk") highRisk += 1;
  }
  const bySource = [...counts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count || (a.source < b.source ? -1 : 1));
  return { total: items.length, pinned, highRisk, bySource };
}
