import { jobs } from "@/lib/jobs";
import { PROVIDER_RECOVERY_EVENT } from "@/lib/routing/provider-auto-disable";

/** Durable recovery for an automatically disabled provider (BI-D28A4F55). */
export const providerRecovery = jobs.createFunction(
  {
    id: "ops/provider-recovery",
    retries: 1,
    triggers: [{ event: PROVIDER_RECOVERY_EVENT }],
  },
  async ({ event, step }) => {
    const { providerId, attempt, delayMs } = event.data as { providerId: string; attempt: number; delayMs: number };
    await step.sleep(`recovery-backoff-${attempt}`, `${Math.max(1, Math.round(delayMs / 1000))}s`);
    return step.run("recover-provider", async () => {
      const { runProviderRecovery } = await import("@/lib/routing/provider-auto-disable");
      return runProviderRecovery({ providerId, attempt });
    });
  },
);
