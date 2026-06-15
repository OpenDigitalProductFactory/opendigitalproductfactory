// Field Dispatch — the dispatcher decision core (F5).
//
// One production policy that composes the field-dispatch primitives into the
// proposed actions a Dispatcher coworker takes for a given board state. It is the
// brain the runtime calls: the F2b server action / coworker resolves the live
// board (jobs + resources from WorkItem + the workforce), calls these functions,
// and COMMITS each proposed action through governance — notify → resolve the
// customer's verified channel bindings + selectCommunicationPlan + an
// AgentActionProposal; assign → a WorkItem assignment proposal; invoice → the
// DPF invoice (F12). The policy itself is PURE: it proposes, it never mutates and
// never sends. That separation is what lets the simulation/eval harness run this
// exact policy through its oracles (the harness's ReferenceDispatcher is the
// self-contained baseline; this is the shipping decision core both it and the
// runtime share — no sim/prod split).
//
// Composition (no new substrate — all four already shipped + unit-proven):
//   - F1   field-dispatch.ts            → lifecycle status predicates
//   - F2a  field-dispatch-notifications → confirmation selection + notification intents
//   - F4   field-dispatch-assignment    → value-aware assignment recommendation
//   - F14  field-dispatch-warranty       → per-component invoice line classification
//
// Pure: no Prisma, no React, no Date.now (Date.parse on caller-supplied ISO only).
// See docs/superpowers/specs/2026-06-13-field-dispatch-capability-design.md (§5).

import {
  type AssignmentCandidate,
  type AssignmentRecommendation,
  type AssignmentUrgency,
  recommendAssignment,
} from "./field-dispatch-assignment";
import {
  type DispatchJobForNotification,
  type DispatchNotificationIntent,
  type NotificationTemplateVars,
  buildNotificationIntent,
  selectConfirmationDueJobs,
} from "./field-dispatch-notifications";
import { type FieldDispatchJobStatus } from "./field-dispatch";
import {
  type ClassifiedServiceLine,
  type EquipmentWarranty,
  type ServiceLine,
  billableTotal,
  classifyServiceLines,
} from "./field-dispatch-warranty";

// ---------------------------------------------------------------------------
// Board state (what the runtime resolves and hands to the policy)
// ---------------------------------------------------------------------------

/**
 * One job as the dispatcher sees it: its lifecycle state, scheduling, current
 * assignment, and the inputs the assignment + notification primitives need. The
 * runtime projects this from a `WorkItem` (sourceType = field-service-job) joined
 * to its customer + the resource roster.
 */
export interface DispatchBoardJob {
  jobId: string;
  status: FieldDispatchJobStatus;
  /** ISO-8601 scheduled visit time, if scheduled. */
  scheduledForIso?: string | null;
  /** ISO-8601 when the customer confirmed, if they have. */
  confirmedAtIso?: string | null;
  /** Currently assigned resource id, if any (absent → a candidate for assignment). */
  assignedResourceId?: string | null;
  /** Skills the job requires; a resource missing any is ineligible (F4 hard gate). */
  requiredSkills?: string[];
  /** Job urgency — shapes the F4 assignment weights and the notification urgency. */
  urgency?: AssignmentUrgency;
  /** 0–1 weight for the job's value in assignment scoring (high-ticket install → near 1). */
  valueWeight?: number;
  /** Message-render vars for any customer notification on this job. */
  notificationVars?: NotificationTemplateVars;
}

/** The board snapshot the periodic sweep reasons over. */
export interface DispatchBoard {
  jobs: DispatchBoardJob[];
  /** The resource roster the runtime resolved (geo/availability/load/value-fit already scored). */
  resources: AssignmentCandidate[];
}

// ---------------------------------------------------------------------------
// Proposed actions (the policy output — the runtime commits these)
// ---------------------------------------------------------------------------

/**
 * A single thing the dispatcher proposes to do. Every variant is a PROPOSAL: the
 * runtime decides whether to auto-commit (a configured automation policy + high
 * confidence) or route to human approval, and is responsible for idempotency
 * (not re-sending a notification already sent). The policy is stateless.
 */
export type DispatcherAction =
  /** Send a customer notification (confirm / on-my-way / running-late / complete). */
  | { kind: "notify"; jobId: string; intent: DispatchNotificationIntent }
  /** Assign a resource to a job; `recommendation` carries the F4 ranking + confidence. */
  | { kind: "assign"; jobId: string; resourceId: string; recommendation: AssignmentRecommendation }
  /** No eligible resource for a job that needs one — a board exception, not an assignment. */
  | { kind: "flag-unassignable"; jobId: string; reason: string }
  /** A job in a state that needs a dispatcher's eyes (no valid state / un-scheduled quote). */
  | { kind: "flag-attention"; jobId: string; reason: string }
  /** Generate the field invoice; `classifiedLines`/`billableTotal` present when warranty was supplied. */
  | { kind: "invoice"; jobId: string; classifiedLines?: ClassifiedServiceLine[]; billableTotal?: number };

/** Statuses for which an unassigned job should get an assignment proposal. */
const ASSIGNABLE: ReadonlySet<FieldDispatchJobStatus> = new Set(["scheduled", "confirmed"]);

function jobsForNotification(jobs: DispatchBoardJob[]): DispatchJobForNotification[] {
  return jobs.map((j) => ({
    jobId: j.jobId,
    status: j.status,
    scheduledForIso: j.scheduledForIso,
    confirmedAtIso: j.confirmedAtIso,
  }));
}

function notificationVars(job: DispatchBoardJob): NotificationTemplateVars {
  // company falls back to "your service provider" inside renderNotificationMessage.
  return job.notificationVars ?? { company: "" };
}

export interface PlanBoardOptions {
  /** Confirmation look-ahead window in hours (default 36, matching F2a). */
  confirmationWindowHours?: number;
}

/**
 * The periodic sweep — "given the board right now, what should the dispatcher
 * propose?" Three concerns, composed from the primitives:
 *   1. Confirmations  (F2a) — scheduled-unconfirmed jobs inside the look-ahead window.
 *   2. Assignment     (F4)  — unassigned scheduled/confirmed jobs → best eligible
 *                             resource, or a flag when none is eligible.
 *   3. Attention            — jobs in a state no other concern handles
 *                             (needs-review, an un-scheduled quote).
 * Stateless and idempotent on an unchanged board: it never proposes a confirmation
 * for an already-confirmed job, nor an assignment for an already-assigned one, so
 * the runtime can run it on every probe and dedupe only the notifications it sent.
 */
export function planBoardActions(
  board: DispatchBoard,
  nowIso: string,
  opts: PlanBoardOptions = {},
): DispatcherAction[] {
  const actions: DispatcherAction[] = [];
  const byId = new Map(board.jobs.map((j) => [j.jobId, j]));

  // 1. Confirmations (F2a owns the windowing rule).
  for (const due of selectConfirmationDueJobs(jobsForNotification(board.jobs), nowIso, opts.confirmationWindowHours)) {
    const job = byId.get(due.jobId);
    if (!job) continue;
    actions.push({ kind: "notify", jobId: job.jobId, intent: buildNotificationIntent("confirm", job.jobId, notificationVars(job)) });
  }

  // 2. Assignment (F4 owns eligibility + scoring).
  for (const job of board.jobs) {
    if (job.assignedResourceId) continue;
    if (!ASSIGNABLE.has(job.status)) continue;
    const recommendation = recommendAssignment(
      { requiredSkills: job.requiredSkills, urgency: job.urgency, valueWeight: job.valueWeight },
      board.resources,
    );
    if (recommendation.recommended) {
      actions.push({ kind: "assign", jobId: job.jobId, resourceId: recommendation.recommended.resourceId, recommendation });
    } else {
      actions.push({ kind: "flag-unassignable", jobId: job.jobId, reason: "no eligible resource (skill or availability)" });
    }
  }

  // 3. Attention — states no other concern handles.
  for (const job of board.jobs) {
    if (job.status === "needs-review") {
      actions.push({ kind: "flag-attention", jobId: job.jobId, reason: "no valid dispatch state" });
    } else if (job.status === "quoted") {
      actions.push({ kind: "flag-attention", jobId: job.jobId, reason: "quote awaiting scheduling" });
    }
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Event-driven decision points (mirroring the harness Dispatcher seams)
// ---------------------------------------------------------------------------

/** ISO arrival ETA is past the promised window end → the visit is running late. */
export function isArrivalLate(arrivalEtaIso?: string | null, windowEndIso?: string | null): boolean {
  if (!arrivalEtaIso || !windowEndIso) return false;
  const eta = Date.parse(arrivalEtaIso);
  const end = Date.parse(windowEndIso);
  if (Number.isNaN(eta) || Number.isNaN(end)) return false;
  return eta > end;
}

export interface DepartureContext {
  jobId: string;
  notificationVars?: NotificationTemplateVars;
  /** Estimated arrival (ISO) and the promised window end (ISO) — late if eta > window end. */
  arrivalEtaIso?: string | null;
  windowEndIso?: string | null;
}

/**
 * A technician departed for a job: always an on-my-way notification, and a
 * running-late notification too when the resolved ETA already slips the promised
 * window (the running-late urgency is higher — F2a maps it to `urgent`). The same
 * shape serves a mid-drive ETA-slip update; the runtime dedupes a repeated
 * running-late.
 */
export function planDepartureActions(ctx: DepartureContext): DispatcherAction[] {
  const vars = ctx.notificationVars ?? { company: "" };
  const actions: DispatcherAction[] = [
    { kind: "notify", jobId: ctx.jobId, intent: buildNotificationIntent("on-my-way", ctx.jobId, vars) },
  ];
  if (isArrivalLate(ctx.arrivalEtaIso, ctx.windowEndIso)) {
    actions.push({ kind: "notify", jobId: ctx.jobId, intent: buildNotificationIntent("running-late", ctx.jobId, vars) });
  }
  return actions;
}

export interface CompletionContext {
  jobId: string;
  notificationVars?: NotificationTemplateVars;
  /**
   * Optional warranty inputs. When present the invoice action carries
   * warranty-classified lines (covered parts → $0 to the customer) and the
   * billable total; absent → a plain invoice the runtime prices itself.
   */
  warranty?: { equipment: EquipmentWarranty; lines: ServiceLine[]; atIso: string };
}

/**
 * A job completed: notify the customer it is done, and propose the invoice. When
 * warranty context is supplied the invoice proposal already classifies each line
 * (F14) — e.g. a compressor under a 10-year parts warranty bills the part at $0
 * while labor stays billable.
 */
export function planCompletionActions(ctx: CompletionContext): DispatcherAction[] {
  const vars = ctx.notificationVars ?? { company: "" };
  const actions: DispatcherAction[] = [
    { kind: "notify", jobId: ctx.jobId, intent: buildNotificationIntent("complete", ctx.jobId, vars) },
  ];
  if (ctx.warranty) {
    const classifiedLines = classifyServiceLines(ctx.warranty.equipment, ctx.warranty.lines, ctx.warranty.atIso);
    actions.push({ kind: "invoice", jobId: ctx.jobId, classifiedLines, billableTotal: billableTotal(classifiedLines) });
  } else {
    actions.push({ kind: "invoice", jobId: ctx.jobId });
  }
  return actions;
}
