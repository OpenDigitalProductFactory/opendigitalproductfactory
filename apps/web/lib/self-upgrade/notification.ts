import { prisma } from "@dpf/db";

type SelfUpgradeNotification = {
  type: "started" | "completed" | "failed" | "skipped";
  runId?: string;
  trigger?: string;
  currentSha?: string | null;
  targetSha?: string | null;
  reason?: string;
  completedBuildIds?: string[];
  containerName?: string;
};

function notificationMessage(event: SelfUpgradeNotification): string {
  if (event.type === "started") {
    return `Portal self-upgrade ${event.runId} started from ${event.currentSha?.slice(0, 12) ?? "unknown"} to ${event.targetSha?.slice(0, 12) ?? "unknown"}.`;
  }
  if (event.type === "completed") {
    return `Portal self-upgrade ${event.runId} completed. Build completions: ${event.completedBuildIds?.join(", ") || "none"}.`;
  }
  if (event.type === "failed") {
    return `Portal self-upgrade ${event.runId ?? "run"} needs attention: ${event.reason ?? "unknown failure"}.`;
  }
  return `Portal self-upgrade skipped: ${event.reason ?? "not required"}.`;
}

export async function notifySelfUpgradeEvent(event: SelfUpgradeNotification): Promise<void> {
  const severity = event.type === "failed" ? "warning" : "info";
  await prisma.platformNotification.create({
    data: {
      severity,
      category: "self-upgrade",
      subjectId: event.runId ?? null,
      message: notificationMessage(event),
    },
  }).catch(() => undefined);
}
