// ─── Operator triage lens for the Operations backlog ───────────────────────
// BI-9952EA9E: /ops is a wall of 470+ items across 27 epics with no "what should
// the operator do next". Items of wildly different altitude get equal weight.
// This derives the SMALL set of items genuinely awaiting an OPERATOR decision —
// prioritized — from fields already on BacklogItem (status, triageOutcome,
// effortSize, active build phase, claim state, demand inputs, staleness).
//
// Ordering (per the BI): blocking-a-customer/business-outcome first, then
// risk/severity, then staleness.
//
// Pure + dependency-free so it is unit-testable and safe in client components.

import type { BacklogItemWithRelations } from "@/lib/backlog";
import { resolveBacklogBuildActionState } from "@/lib/backlog-build-action-state";

/** Why an item is on the operator's plate — the human decision it is awaiting. */
export type OperatorTriageReason =
  | "awaiting-triage" // status "triaging" — needs a disposition decision
  | "ready-to-build" // triaged to build + effort-sized — awaiting launch
  | "build-attention" // linked build failed or is unavailable — needs intervention
  | "blocked" // work claim explicitly blocked — needs unblocking
  | "stalled"; // flagged stale and still live — needs a call

/**
 * Whose plate is this on (BI-01CC2356)?
 * - "mine": genuinely on the current operator's plate now — work they've claimed,
 *   or a broken/blocked item a human must personally intervene on.
 * - "company": routine platform throughput (triage / launch / stale calls) that
 *   is company-wide, not a personal must-decide-now item.
 * The band defaults to "mine" and lets the operator opt into the "company" pool,
 * so a 171-wide queue stops masquerading as 171 personal decisions.
 */
export type OperatorTriageScope = "mine" | "company";

export type OperatorTriageEntry = {
  item: BacklogItemWithRelations;
  reason: OperatorTriageReason;
  /** True when the item plausibly blocks a customer or business outcome. */
  blocksBusinessOutcome: boolean;
  /** Whose plate the item is on — the mine-vs-company lens. */
  scope: OperatorTriageScope;
  /** Ordering keys (exposed for tests + UI transparency). */
  businessScore: number;
  riskScore: number;
  stalenessDays: number;
};

export const OPERATOR_TRIAGE_REASON_LABEL: Record<OperatorTriageReason, string> = {
  "awaiting-triage": "Awaiting triage",
  "ready-to-build": "Ready to build",
  "build-attention": "Build needs attention",
  blocked: "Blocked",
  stalled: "Stalled",
};

export const OPERATOR_TRIAGE_REASON_HINT: Record<OperatorTriageReason, string> = {
  "awaiting-triage": "No disposition decided yet — triage it (build / runbook / coworker / defer).",
  "ready-to-build": "Triaged to build and sized — launch it into Build Studio.",
  "build-attention": "Its Build Studio draft failed or is unavailable — intervene.",
  blocked: "The work claim is blocked — unblock or reassign.",
  stalled: "Flagged stale while still live — decide whether it still matters.",
};

const TERMINAL_STATUSES = new Set(["done", "deferred"]);
const CLOSED_TRIAGE_OUTCOMES = new Set(["discard", "duplicate", "defer"]);
const FAILED_BUILD_PHASES = new Set(["failed", "panicked", "abandoned"]);

const DAY_MS = 1000 * 60 * 60 * 24;

function daysBetween(from: Date | null | undefined, now: Date): number {
  if (!from) return 0;
  const ms = now.getTime() - new Date(from).getTime();
  return ms > 0 ? ms / DAY_MS : 0;
}

/** The severity a given operator reason contributes to the risk key: a broken
 *  build or a blocked claim is itself a risk/severity signal. */
function reasonRisk(reason: OperatorTriageReason): number {
  switch (reason) {
    case "build-attention":
      return 4;
    case "blocked":
      return 3;
    default:
      return 0;
  }
}

/** Classify a single item — returns the primary operator reason, or null when
 *  the item needs no operator decision right now (agent working, terminal, or a
 *  closed disposition). The most action-urgent reason wins when several apply. */
export function classifyOperatorReason(
  item: BacklogItemWithRelations,
): OperatorTriageReason | null {
  if (TERMINAL_STATUSES.has(item.status)) return null;
  if (item.triageOutcome && CLOSED_TRIAGE_OUTCOMES.has(item.triageOutcome)) return null;

  // A broken/unavailable linked build outranks everything — the operator must act
  // for work to move at all.
  const phase = item.activeBuild?.phase ?? null;
  if (item.activeBuild && phase && FAILED_BUILD_PHASES.has(phase)) return "build-attention";
  if (item.activeBuildId && !item.activeBuild) return "build-attention";

  // A healthy in-flight build means an agent is working — nothing for the operator.
  if (item.activeBuild) return null;

  if (item.claimStatus === "blocked") return "blocked";

  // No disposition decided yet — the classic "awaiting an operator decision" state.
  if (item.status === "triaging") return "awaiting-triage";

  // Triaged to build, open, and effort-sized — awaiting the operator to launch it.
  if (resolveBacklogBuildActionState(item).kind === "start") return "ready-to-build";

  // Explicitly flagged stale while still live — needs a keep-or-kill call.
  if (item.stalenessDetectedAt) return "stalled";

  return null;
}

/** True when the item plausibly blocks a customer or business outcome — used as a
 *  UI flag and folded into the ordering. Bugs block users; explicit demand inputs
 *  (businessValue / timeCriticality) name a business stake. */
function blocksBusinessOutcome(item: BacklogItemWithRelations): boolean {
  return (
    (item.businessValue ?? 0) > 0 ||
    (item.timeCriticality ?? 0) > 0 ||
    item.workType === "bug"
  );
}

function businessScore(item: BacklogItemWithRelations): number {
  return (item.businessValue ?? 0) * 2 + (item.timeCriticality ?? 0) + (item.workType === "bug" ? 3 : 0);
}

function riskScore(item: BacklogItemWithRelations, reason: OperatorTriageReason): number {
  return (item.riskOpportunity ?? 0) + (item.workType === "bug" ? 2 : 0) + reasonRisk(reason);
}

/**
 * Whose plate is this item on (BI-01CC2356)? "mine" when the current principal
 * has actively claimed it, OR when it is broken/blocked and a human must step in
 * (build-attention / blocked). Everything else — routine triage, launch, and
 * stale calls — is company-wide throughput. With no principalId, ownership can't
 * be resolved, so the split degrades to the urgency signal alone.
 */
export function resolveOperatorScope(
  item: BacklogItemWithRelations,
  reason: OperatorTriageReason,
  principalId?: string | null,
): OperatorTriageScope {
  if (principalId && item.claimedById && item.claimedById === principalId) return "mine";
  if (reason === "build-attention" || reason === "blocked") return "mine";
  return "company";
}

/**
 * Select and prioritize the small set of items awaiting an operator decision.
 *
 * Ordering (BI-9952EA9E): business-outcome first → risk/severity → staleness,
 * with priority / createdAt / itemId as deterministic tiebreakers.
 *
 * @param items every backlog item (unassigned + epic children, flattened)
 * @param now injectable clock for staleness (defaults to wall-clock)
 * @param principalId current operator's user id — resolves the "mine" scope
 *   (BI-01CC2356). Optional; when omitted the scope split uses the urgency
 *   signal only.
 */
export function selectOperatorQueue(
  items: BacklogItemWithRelations[],
  now: Date = new Date(),
  principalId?: string | null,
): OperatorTriageEntry[] {
  const entries: OperatorTriageEntry[] = [];
  for (const item of items) {
    const reason = classifyOperatorReason(item);
    if (!reason) continue;
    entries.push({
      item,
      reason,
      blocksBusinessOutcome: blocksBusinessOutcome(item),
      scope: resolveOperatorScope(item, reason, principalId),
      businessScore: businessScore(item),
      riskScore: riskScore(item, reason),
      stalenessDays: daysBetween(item.stalenessDetectedAt ?? item.updatedAt, now),
    });
  }

  return entries.sort((a, b) => {
    if (a.businessScore !== b.businessScore) return b.businessScore - a.businessScore;
    if (a.riskScore !== b.riskScore) return b.riskScore - a.riskScore;
    if (a.stalenessDays !== b.stalenessDays) return b.stalenessDays - a.stalenessDays;
    // Lower priority number = more important; nulls sort last.
    const pa = a.item.priority ?? Number.POSITIVE_INFINITY;
    const pb = b.item.priority ?? Number.POSITIVE_INFINITY;
    if (pa !== pb) return pa - pb;
    const ca = new Date(a.item.createdAt).getTime();
    const cb = new Date(b.item.createdAt).getTime();
    if (ca !== cb) return ca - cb;
    return a.item.itemId.localeCompare(b.item.itemId);
  });
}

export type OperatorQueuePartition = {
  /** Genuinely on the operator's plate now — the default lens. */
  mine: OperatorTriageEntry[];
  /** Company-wide platform throughput — opt-in, not personal decisions. */
  company: OperatorTriageEntry[];
};

/**
 * Split the prioritized operator queue into a personal lens and the company-wide
 * pool (BI-01CC2356). Preserves the existing ordering within each side — this is
 * a pure partition, not a re-sort — so "mine" leads with the most urgent item.
 *
 * @param items every backlog item (unassigned + epic children, flattened)
 * @param principalId current operator's user id (resolves claim ownership)
 * @param now injectable clock for staleness
 */
export function partitionOperatorQueue(
  items: BacklogItemWithRelations[],
  principalId?: string | null,
  now: Date = new Date(),
): OperatorQueuePartition {
  const queue = selectOperatorQueue(items, now, principalId);
  const mine: OperatorTriageEntry[] = [];
  const company: OperatorTriageEntry[] = [];
  for (const entry of queue) {
    (entry.scope === "mine" ? mine : company).push(entry);
  }
  return { mine, company };
}
