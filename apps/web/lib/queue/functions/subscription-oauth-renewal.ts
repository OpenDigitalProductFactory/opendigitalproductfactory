// Background renewal of subscription OAuth sign-ins (BI-A53C594E). A thin cron
// wrapper; the per-account logic and its backoff live in
// lib/inference/subscription-oauth-renewal.ts so tests drive it without Inngest.

import { cron } from "@/lib/jobs/triggers";
import { jobs } from "@/lib/jobs";
import { gateAtEntry } from "../quiescence-gates";

export const SUBSCRIPTION_OAUTH_RENEWAL_FUNCTION_ID = "ops/subscription-oauth-renewal";

export const subscriptionOAuthRenewal = jobs.createFunction(
  {
    id: SUBSCRIPTION_OAUTH_RENEWAL_FUNCTION_ID,
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("*/10 * * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, SUBSCRIPTION_OAUTH_RENEWAL_FUNCTION_ID);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return step.run("renew-subscription-sign-ins", async () => {
      const { runSubscriptionOAuthRenewal } = await import("@/lib/inference/subscription-oauth-renewal");
      return runSubscriptionOAuthRenewal();
    });
  },
);
