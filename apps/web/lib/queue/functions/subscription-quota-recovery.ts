import { jobs } from "@/lib/jobs";

export const subscriptionQuotaRecovery = jobs.createFunction(
  { id: "ops/subscription-quota-recovery", retries: 1, concurrency: { limit: 1 },
    triggers: [{ cron: "3,8,13,18,23,28,33,38,43,48,53,58 * * * *" }] },
  async ({ step }) => step.run("recheck-due-subscriptions", async () => {
    const { recheckSubscriptionQuotas } = await import("@/lib/routing/subscription-quota-recovery");
    return { outcomes: await recheckSubscriptionQuotas() };
  }),
);
