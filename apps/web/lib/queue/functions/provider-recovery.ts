import { jobs } from "@/lib/jobs";
import { PROVIDER_RECOVERY_EVENT } from "@/lib/routing/provider-auto-disable";

/**
 * Durable recovery for an automatically disabled provider (BI-D28A4F55) or,
 * when the event names a connectionId, one provider account (BI-0ADD46C3).
 */
export const providerRecovery = jobs.createFunction(
  {
    id: "ops/provider-recovery",
    retries: 1,
    triggers: [{ event: PROVIDER_RECOVERY_EVENT }],
  },
  async ({ event, step }) => {
    const { providerId, connectionId, attempt, delayMs } = event.data as { providerId: string; connectionId?: string; attempt: number; delayMs: number };
    await step.sleep(`recovery-backoff-${attempt}`, `${Math.max(1, Math.round(delayMs / 1000))}s`);
    if (connectionId) {
      return step.run("recover-provider-account", async () => {
        const { runProviderAccountRecovery } = await import("@/lib/routing/provider-account-auto-disable");
        const { getProviderBearerToken } = await import("@/lib/inference/provider-account-credentials");
        // The same guarded account path the router and background renewal use.
        return runProviderAccountRecovery({ providerId, connectionId, attempt }, {
          renew: async (id, connection) => {
            const result = await getProviderBearerToken(id, connection, undefined, { forceRefresh: true });
            return "token" in result ? { renewed: true } : { renewed: false, reason: result.error };
          },
        });
      });
    }
    return step.run("recover-provider", async () => {
      const { runProviderRecovery } = await import("@/lib/routing/provider-auto-disable");
      return runProviderRecovery({ providerId, attempt });
    });
  },
);
