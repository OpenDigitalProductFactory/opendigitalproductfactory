import { jobs } from "@/lib/jobs";
import { PROVIDER_PAUSE_EXPIRY_EVENT } from "@/lib/inference/provider-operator-pause";

export const providerPauseExpiry = jobs.createFunction(
  { id: "ops/provider-pause-expiry", retries: 2, triggers: [{ event: PROVIDER_PAUSE_EXPIRY_EVENT }] },
  async ({ event, step }) => {
    const { providerId, operationId, resumeAt } = event.data as { providerId: string; operationId: string; resumeAt: string };
    if (!["local", "ollama"].includes(providerId) || !operationId || !Number.isFinite(Date.parse(resumeAt))) return { outcome: "invalid-event" };
    await step.sleepUntil("pause-expiry", resumeAt);
    return step.run("expire-current-pause", async () => {
      const { resumeLocalProvider } = await import("@/lib/inference/provider-operator-pause");
      return resumeLocalProvider({ providerId, operationId, automatic: true });
    });
  },
);

export const providerPauseReconcile = jobs.createFunction(
  { id: "ops/provider-pause-reconcile", retries: 1, triggers: [{ cron: "*/5 * * * *" }] },
  async ({ step }) => step.run("resume-overdue-pauses", async () => {
    const { reconcileOverdueProviderPauses } = await import("@/lib/inference/provider-operator-pause");
    return { resumed: await reconcileOverdueProviderPauses() };
  }),
);
