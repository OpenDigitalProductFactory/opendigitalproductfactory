// apps/web/lib/routing/rate-recovery.ts
import { prisma } from "@dpf/db";

const DEFAULT_RECOVERY_MS = 60_000;
const recoveryTimers = new Map<string, NodeJS.Timeout>();

function rateKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

export function scheduleRecovery(
  providerId: string,
  modelId: string,
  delayMs: number = DEFAULT_RECOVERY_MS,
): void {
  const key = rateKey(providerId, modelId);
  const existing = recoveryTimers.get(key);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    recoveryTimers.delete(key);
    await prisma.modelProfile
      .updateMany({
        where: { providerId, modelId, modelStatus: "degraded" },
        data: { modelStatus: "active" },
      })
      .catch((err) =>
        console.error(`[rate-recovery] Failed to restore ${key}:`, err),
      );
  }, delayMs);

  recoveryTimers.set(key, timer);
}

export function cancelRecovery(providerId: string, modelId: string): void {
  const key = rateKey(providerId, modelId);
  const timer = recoveryTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    recoveryTimers.delete(key);
  }
}

export function _resetAllRecoveries(): void {
  for (const timer of recoveryTimers.values()) {
    clearTimeout(timer);
  }
  recoveryTimers.clear();
}
