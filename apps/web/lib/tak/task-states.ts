export const TASK_STATES = [
  "submitted",
  "working",
  "input-required",
  "auth-required",
  "completed",
  "failed",
  "canceled",
  "rejected",
  "archived",
  // BI-4ab6be39 stall detection — watchdog-detected silence past phase
  // threshold. Terminal-equivalent for scheduling (NOT in TASK_IN_FLIGHT_STATES);
  // operator can transition to working (Retry) or canceled (Abandon).
  "stalled",
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export const TASK_IN_FLIGHT_STATES = [
  "submitted",
  "working",
  "input-required",
  "auth-required",
] as const satisfies readonly TaskState[];
