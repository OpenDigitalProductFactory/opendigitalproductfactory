import { jobs } from "@/lib/jobs";

/**
 * Geocode one saved location (BI-C318C227 §2.1). One function serves both
 * events with concurrency 1, so every on-save lookup on the install shares one
 * queue and waits the provider's interval: the same pacing the backfill keeps.
 * The provider is re-read per run, so switching it to `none` drains the queue
 * without a call.
 */
export const geocodeOnSave = jobs.createFunction(
  {
    id: "geocode/on-save",
    retries: 2,
    concurrency: [{ limit: 1 }],
    triggers: [{ event: "geocode/address.requested" }, { event: "geocode/organization.requested" }],
  },
  async ({ event, step }) => {
    const data = event.data as { addressId?: string; organizationId?: string };
    const { outcome, intervalMs } = await step.run("geocode", async () => {
      const { prisma } = await import("@dpf/db");
      const { activeProvider } = await import("@/lib/geocoding/backfill.server");
      const { geocodeOrganizationAddress, geocodeSavedAddress } = await import("@/lib/geocoding/on-save");
      const provider = await activeProvider();
      const deps = { fetchImpl: fetch };
      const db = prisma as unknown as import("@/lib/geocoding/on-save").OnSaveDb;
      const result = data.organizationId
        ? await geocodeOrganizationAddress(db, provider, data.organizationId, deps)
        : data.addressId
          ? await geocodeSavedAddress(db, provider, data.addressId, deps)
          : "skipped";
      return { outcome: result, intervalMs: provider.enabled ? provider.minIntervalMs : 0 };
    });
    if (outcome !== "skipped" && intervalMs > 0) await step.sleep("provider-interval", intervalMs);
    return { outcome };
  },
);
