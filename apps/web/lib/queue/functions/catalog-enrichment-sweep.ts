// Catalog enrichment sweep (EP-ASSET-INTELLIGENCE, spec §4.2/§4.4).
//
// Turns the already-built endoflife.date / CPE / SBOM feed logic into a governed
// autonomous loop: a weekly cron pass over the CatalogIdentity spine plus a manual
// "run now" event for the admin Scheduled Jobs surface. Quiescence-gated (skips
// during a self-upgrade drain) and honors the ScheduledJob.enabled kill switch
// inside the runner.

import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";
import {
  CATALOG_SWEEP_CRON,
  CATALOG_SWEEP_REQUESTED_EVENT,
  CATALOG_SWEEP_SCHEDULED_INNGEST_ID,
  CATALOG_SWEEP_REQUESTED_INNGEST_ID,
} from "@/lib/asset-intelligence/catalog-sweep-constants";

export const catalogEnrichmentSweepScheduled = inngest.createFunction(
  {
    id: CATALOG_SWEEP_SCHEDULED_INNGEST_ID,
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron(CATALOG_SWEEP_CRON)],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, CATALOG_SWEEP_SCHEDULED_INNGEST_ID);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return step.run("catalog-enrichment-sweep", async () => {
      const { runCatalogEnrichmentSweepJob } = await import(
        "@/lib/asset-intelligence/catalog-sweep-runner"
      );
      return runCatalogEnrichmentSweepJob();
    });
  },
);

// Manual one-shot trigger for the admin "run now" action; supports an optional
// smaller batch limit for a quick poll.
export const catalogEnrichmentSweepRequested = inngest.createFunction(
  {
    id: CATALOG_SWEEP_REQUESTED_INNGEST_ID,
    retries: 1,
    triggers: [{ event: CATALOG_SWEEP_REQUESTED_EVENT }],
  },
  async ({ event, step }) => {
    const limit = (event.data as { limit?: number } | undefined)?.limit;
    return step.run("catalog-enrichment-sweep-manual", async () => {
      const { runCatalogEnrichmentSweepJob } = await import(
        "@/lib/asset-intelligence/catalog-sweep-runner"
      );
      return runCatalogEnrichmentSweepJob(typeof limit === "number" ? { limit } : {});
    });
  },
);
