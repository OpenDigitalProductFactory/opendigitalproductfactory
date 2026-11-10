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

export function notificationMessage(event: SelfUpgradeNotification): string {
  if (event.type === "started") {
    return `Portal self-upgrade ${event.runId} started from ${event.currentSha?.slice(0, 12) ?? "unknown"} to ${event.targetSha?.slice(0, 12) ?? "unknown"}.`;
  }
  if (event.type === "completed") {
    const builds = event.completedBuildIds?.length ? ` Build completions: ${event.completedBuildIds.join(", ")}.` : "";
    return `Portal self-upgrade ${event.runId} completed.${builds}`;
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
  }).catch((err: unknown) => {
    // Upgrade state is already persisted elsewhere; notification failure must not mask it.
    console.warn("[self-upgrade] notification write failed:", err);
  });
}

/**
 * BI-E7974C18 — the new serving process says the upgrade that produced it
 * completed. The old process cannot: the swap replaces it first. Once per run,
 * so a restart writes nothing. Fail-open.
 */
export async function notifySelfUpgradeCompletedFor(deployedSha: string | null): Promise<void> {
  if (!deployedSha) return;
  try {
    const run = await prisma.selfUpgradeRun.findFirst({
      where: {
        status: "succeeded",
        OR: [
          { deployedSha: { equals: deployedSha, mode: "insensitive" } },
          { deployedSha: null, targetSha: { equals: deployedSha, mode: "insensitive" } },
        ],
      },
      orderBy: { completedAt: "desc" },
      select: { runId: true },
    });
    if (!run) return;
    const message = notificationMessage({ type: "completed", runId: run.runId });
    const already = await prisma.platformNotification.findFirst({
      where: { category: "self-upgrade", subjectId: run.runId, message },
      select: { id: true },
    });
    if (already) return;
    await notifySelfUpgradeEvent({ type: "completed", runId: run.runId });
  } catch (err: unknown) {
    console.warn("[self-upgrade] completion notification skipped:", err);
  }
}
