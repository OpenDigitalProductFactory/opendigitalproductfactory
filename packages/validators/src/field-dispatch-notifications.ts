import type { FieldDispatchJobStatus } from "./field-dispatch";

// Field Dispatch — customer notification decision logic (F2a).
//
// The pure, field-dispatch-SPECIFIC core of the Dispatcher coworker's
// customer-communication behaviour: which jobs need a confirmation today, what
// urgency each dispatch event carries, and the message text. It deliberately
// does NOT do channel selection or delivery — DPF already owns that substrate
// (`selectCommunicationPlan` over verified `CommunicationChannelBinding`s, the
// communication dispatcher, and `CommunicationDeliveryAttempt`). The runtime
// (F2b) resolves the customer's bindings, calls `selectCommunicationPlan(urgency,
// bindings)`, and proposes the send through the governed-approval path — never
// auto-send unless an explicit automation policy is configured.
//
// Pure: no Prisma, no Date.now. See
// docs/superpowers/specs/2026-06-13-field-dispatch-capability-design.md
// (ADR-3, §7.1, §8.4).

/**
 * The four customer-facing dispatch events. Mirrors the
 * `FieldDispatchProfile.notificationEvents` set (storefront-templates) — kept as
 * an independent literal here to avoid an archetype-layer dependency.
 */
export type DispatchNotificationEvent = "confirm" | "on-my-way" | "running-late" | "complete";

/**
 * Field-dispatch urgency, value-compatible with the platform
 * `CommunicationUrgency` (`apps/web/lib/communications/channel-types.ts`).
 * Re-declared (not imported) to keep the dependency direction clean — the
 * runtime passes this straight into `selectCommunicationPlan`.
 */
export type DispatchNotificationUrgency = "routine" | "priority" | "urgent" | "emergency";

/**
 * Map a dispatch event to the urgency the platform channel-selection policy
 * reads. On-my-way is time-sensitive (priority); running-late is the moment a
 * customer is actively waiting (urgent); confirm/complete are routine.
 */
export function dispatchEventUrgency(event: DispatchNotificationEvent): DispatchNotificationUrgency {
  switch (event) {
    case "running-late":
      return "urgent";
    case "on-my-way":
      return "priority";
    case "confirm":
    case "complete":
      return "routine";
  }
}

// ---------------------------------------------------------------------------
// Confirmation selection (T-24h scheduled automation)
// ---------------------------------------------------------------------------

export interface DispatchJobForNotification {
  jobId: string;
  status: FieldDispatchJobStatus;
  /** When the visit is scheduled (ISO-8601), if scheduled. */
  scheduledForIso?: string | null;
  /** When the customer confirmed, if they have (ISO-8601). */
  confirmedAtIso?: string | null;
}

const MS_PER_HOUR = 3_600_000;

/** Hours from `nowIso` until `whenIso` (negative = in the past). null if unparseable. */
function hoursUntil(whenIso: string, nowIso: string): number | null {
  const when = Date.parse(whenIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(when) || Number.isNaN(now)) return null;
  return (when - now) / MS_PER_HOUR;
}

/**
 * True when a job should get an appointment-confirmation proposal now: it is
 * scheduled (not yet confirmed, not cancelled/quoted), and its visit falls
 * within the look-ahead window (default 36h — wide enough that a daily probe
 * catches "tomorrow's" jobs regardless of the hour it runs).
 */
export function shouldProposeConfirmation(
  job: DispatchJobForNotification,
  nowIso: string,
  windowHours = 36,
): boolean {
  if (job.status !== "scheduled") return false;
  if (job.confirmedAtIso) return false;
  if (!job.scheduledForIso) return false;
  const h = hoursUntil(job.scheduledForIso, nowIso);
  return h !== null && h > 0 && h <= windowHours;
}

/** The subset of `jobs` due for a confirmation proposal now. */
export function selectConfirmationDueJobs(
  jobs: DispatchJobForNotification[],
  nowIso: string,
  windowHours = 36,
): DispatchJobForNotification[] {
  return jobs.filter((job) => shouldProposeConfirmation(job, nowIso, windowHours));
}

// ---------------------------------------------------------------------------
// Message content (§8.4) — operator-overridable defaults
// ---------------------------------------------------------------------------

export interface NotificationTemplateVars {
  company: string;
  customerName?: string;
  service?: string;
  dateText?: string;
  timeText?: string;
  etaText?: string;
  address?: string;
  amountText?: string;
  paymentLink?: string;
  technicianName?: string;
  /** Per-vertical noun for the worker, e.g. "technician", "installer", "cleaner". */
  resourceNoun?: string;
}

function fallback(value: string | undefined, placeholder: string): string {
  return value && value.trim().length > 0 ? value : placeholder;
}

const EVENT_TITLE: Record<DispatchNotificationEvent, string> = {
  confirm: "Appointment confirmation",
  "on-my-way": "Your appointment is on the way",
  "running-late": "Running a little behind",
  complete: "Service complete",
};

/** The customer-facing title for a notification event (the platform send needs a title + body). */
export function notificationTitle(event: DispatchNotificationEvent): string {
  return EVENT_TITLE[event];
}

/**
 * Render the default message body for a notification event. These are the seeded
 * defaults; an install's operator (or hive-mind tuning) can override copy later.
 */
export function renderNotificationMessage(event: DispatchNotificationEvent, vars: NotificationTemplateVars): string {
  const company = fallback(vars.company, "your service provider");
  const service = fallback(vars.service, "service");
  const worker = fallback(vars.resourceNoun, "technician");
  switch (event) {
    case "confirm":
      return `Your ${service} appointment with ${company} is confirmed for ${fallback(vars.dateText, "the scheduled date")} at ${fallback(vars.timeText, "the scheduled time")}. Reply YES to confirm or call us to reschedule.`;
    case "on-my-way":
      return `Your ${worker}${vars.technicianName ? ` ${vars.technicianName}` : ""} is on the way to your ${service} appointment. Estimated arrival: ${fallback(vars.etaText, "shortly")}.`;
    case "running-late":
      return `We're running a bit behind — your ${worker} will now arrive at approximately ${fallback(vars.etaText, "a later time")}. We apologize for the delay.`;
    case "complete":
      return `Your ${service} is complete.${vars.amountText ? ` Your invoice for ${vars.amountText} is ready${vars.paymentLink ? `: ${vars.paymentLink}` : ""}.` : ""} Thank you for choosing ${company}.`;
  }
}

// ---------------------------------------------------------------------------
// Notification intent (what the runtime dispatches through the platform)
// ---------------------------------------------------------------------------

/**
 * Everything the runtime needs to dispatch a customer notification through the
 * existing communication substrate: the event, its urgency (→
 * `selectCommunicationPlan`), and the rendered title/body. The runtime resolves
 * the customer's verified channel bindings, picks the channel via the platform
 * policy, and proposes the send for approval (or surfaces a board exception when
 * the plan is empty — no reachable verified channel).
 */
export interface DispatchNotificationIntent {
  event: DispatchNotificationEvent;
  jobId: string;
  urgency: DispatchNotificationUrgency;
  title: string;
  body: string;
}

/** Build the channel-agnostic notification intent for a job + event. */
export function buildNotificationIntent(
  event: DispatchNotificationEvent,
  jobId: string,
  vars: NotificationTemplateVars,
): DispatchNotificationIntent {
  return {
    event,
    jobId,
    urgency: dispatchEventUrgency(event),
    title: notificationTitle(event),
    body: renderNotificationMessage(event, vars),
  };
}
