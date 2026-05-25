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
  // BI-QUIESCE-001 Activity Quiescence Protocol — transitional state written
  // by the coordinator when it flips active TaskRuns during normal→draining.
  // The next heartbeat() call returns false (per heartbeat.ts:27 — its filter
  // is status IN ('working','active')), triggering the cooperative-cancel
  // pathway. The loop's epilogue then transitions to "paused-for-upgrade".
  // NOT in TASK_IN_FLIGHT_STATES because the loop is exiting at next iteration
  // and the entry-point gates refuse to start new work in this state.
  "quiescing",
  // BI-QUIESCE-001 — terminal-equivalent state for a coworker loop that
  // cooperatively exited during quiescence drain. Eligible for operator-
  // triggered Resume via taskrunRetry (per spec §6.2 default: operator-gated
  // in v1). NOT in TASK_IN_FLIGHT_STATES; watchdog must not flag as stall.
  "paused-for-upgrade",
  // BI-QUIESCE-001 — terminal-equivalent state for a coworker loop that did
  // NOT exit within the wait budget and was force-cancelled by the coordinator
  // via agentEventBus.requestCancel. Distinguished from "paused-for-upgrade"
  // so the Resume UI can warn the operator that the prior response may have
  // been truncated mid-execution (per spec §5.2).
  "paused-for-upgrade-forced",
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export const TASK_IN_FLIGHT_STATES = [
  "submitted",
  "working",
  "input-required",
  "auth-required",
] as const satisfies readonly TaskState[];
