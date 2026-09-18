// BI-7F2FBDA3 — refusal-triggered provider catalog refresh.
//
// The nightly model-discovery-refresh (03:10) keeps the catalog honest on a
// cadence; this is the same discovery on DEMAND. When routing or inference
// learns that a provider no longer supports a model, the platform should not
// wait until 03:10 to find out what the provider offers instead. Debounced per
// provider so a burst of refusals costs one discovery, and quiescence-gated
// like every other job that touches the catalog.

import { prisma } from "@dpf/db";

import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";
import { PROVIDER_CATALOG_REFRESH_EVENT } from "@/lib/inference/ai-provider-internals";

export { PROVIDER_CATALOG_REFRESH_EVENT };
/** A provider re-discovered within this window is not re-discovered again. */
export const PROVIDER_CATALOG_REFRESH_DEBOUNCE_MS = 10 * 60 * 1000;

export interface ProviderCatalogRefreshDb {
  discoveredModel: {
    findFirst(args: unknown): Promise<{ lastSeenAt: Date } | null>;
  };
}

/** True when the provider's newest discovery is older than the debounce window. */
export async function providerCatalogRefreshDue(
  db: ProviderCatalogRefreshDb,
  providerId: string,
  now: Date = new Date(),
  debounceMs: number = PROVIDER_CATALOG_REFRESH_DEBOUNCE_MS,
): Promise<boolean> {
  const newest = await db.discoveredModel.findFirst({
    where: { providerId },
    orderBy: { lastSeenAt: "desc" },
    select: { lastSeenAt: true },
  });
  if (!newest) return true;
  return now.getTime() - newest.lastSeenAt.getTime() >= debounceMs;
}

export const providerCatalogRefresh = inngest.createFunction(
  {
    id: "inference/provider-catalog-refresh",
    retries: 1,
    // One refresh per provider at a time; later requests for the same provider
    // fold into the debounce rather than queueing a second discovery.
    concurrency: [{ key: "event.data.providerId", limit: 1 }],
    triggers: [{ event: PROVIDER_CATALOG_REFRESH_EVENT }],
  },
  async ({ event, step }) => {
    const gate = await gateAtEntry(step, "inference/provider-catalog-refresh");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    const providerId = String(event.data?.providerId ?? "");
    if (!providerId) return { skipped: true, reason: "missing providerId" };

    const due = await step.run("debounce", () =>
      providerCatalogRefreshDue(prisma as unknown as ProviderCatalogRefreshDb, providerId),
    );
    if (!due) return { skipped: true, reason: "debounced", providerId };

    const result = await step.run("rediscover-provider", async () => {
      const { autoDiscoverAndProfile } = await import("@/lib/inference/ai-provider-internals");
      const { invalidateRoutingLoaderCache } = await import("@/lib/routing/loader");
      const outcome = await autoDiscoverAndProfile(providerId);
      invalidateRoutingLoaderCache();
      return outcome;
    });
    console.info(`[provider-catalog-refresh] ${JSON.stringify(providerId)} re-discovered on demand (${JSON.stringify(String(event.data?.reason ?? ""))})`);
    return { skipped: false, providerId, result };
  },
);
