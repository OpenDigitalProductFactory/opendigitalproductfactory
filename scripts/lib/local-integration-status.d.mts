export declare const LOCAL_INTEGRATION_STATUSES: readonly [
  "passed",
  "failed",
  "conflict",
  "blocked_sandbox_drift",
  "blocked_control_plane_starvation",
  "blocked_child_signal_death",
  "blocked_dpf2_reservation",
];

export type LocalIntegrationStatus = (typeof LOCAL_INTEGRATION_STATUSES)[number];

export declare function isLocalIntegrationStatus(
  value: unknown,
): value is LocalIntegrationStatus;

export declare function fallbackStatusForUnknown(status: string): {
  status: "failed" | "blocked_control_plane_starvation";
  summaryPrefix: string;
};
