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
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export const TASK_IN_FLIGHT_STATES = [
  "submitted",
  "working",
  "input-required",
  "auth-required",
] as const satisfies readonly TaskState[];
