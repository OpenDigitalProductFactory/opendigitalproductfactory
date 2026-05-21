export type UpgradeEventType =
  | "upgrade.started"
  | "upgrade.succeeded"
  | "upgrade.failed"
  | "upgrade.cancelled";

export type UpgradeEvent = {
  type: UpgradeEventType;
  runId: string;
  payload?: Record<string, unknown>;
};

export async function emitUpgradeEvent(_event: UpgradeEvent): Promise<void> {
  // No-op until agent-event-bus is wired up (see notifications.ts plan).
}
