// Catalog enrichment sweep runner (EP-ASSET-INTELLIGENCE, spec §4.2/§4.4).
//
// Wires the pure @dpf/db sweep logic to the real prisma client + global fetch, and
// maintains the ScheduledJob bookkeeping row (lastRunAt / lastStatus / nextRunAt)
// that the admin Scheduled Jobs surface renders. Honors the per-job enabled kill
// switch (ScheduledJob.enabled=false) like the other governed sweeps.

import type { CatalogSweepResult } from "@dpf/db";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import {
  CATALOG_SWEEP_JOB_ID,
  CATALOG_SWEEP_JOB_NAME,
  CATALOG_SWEEP_BATCH_LIMIT,
} from "./catalog-sweep-constants";

export type CatalogSweepRunOutcome =
  | ({ skipped: false } & CatalogSweepResult)
  | { skipped: true; reason: string };

/**
 * Run one bounded catalog-enrichment pass and record it against the ScheduledJob
 * row. `limit` overrides the default batch size (used by tests / a smaller manual
 * poll). Never throws — feed/DB errors are reflected in the row's lastStatus and a
 * failure count in the result.
 */
export async function runCatalogEnrichmentSweepJob(
  options: { limit?: number } = {},
): Promise<CatalogSweepRunOutcome> {
  const { prisma, runCatalogEnrichmentSweep } = await import("@dpf/db");
  const { computeNextRunAt } = await import("@/lib/ai-provider-types");

  // Ensure the row exists so the admin surface can render + toggle it, and read
  // the kill switch in one shot.
  const job = await prisma.scheduledJob.upsert({
    where: { jobId: CATALOG_SWEEP_JOB_ID },
    create: {
      jobId: CATALOG_SWEEP_JOB_ID,
      name: CATALOG_SWEEP_JOB_NAME,
      schedule: "weekly",
      category: "editable",
      nextRunAt: computeNextRunAt("weekly", new Date()),
    },
    update: {},
    select: { enabled: true, schedule: true },
  });

  if (job.enabled === false) {
    return { skipped: true, reason: "disabled" };
  }

  await prisma.scheduledJob
    .update({
      where: { jobId: CATALOG_SWEEP_JOB_ID },
      data: { lastRunAt: new Date(), lastStatus: "running" },
    })
    .catch(() => {});

  try {
    const result = await runCatalogEnrichmentSweep(
      // The @dpf/db feed modules type their prisma surface as minimal hand-rolled
      // client shapes (method-shorthand, so bivariant); the real client satisfies
      // them structurally. This is the first prisma wiring of those feeds.
      prisma as unknown as Parameters<typeof runCatalogEnrichmentSweep>[0],
      {
        limit: options.limit ?? CATALOG_SWEEP_BATCH_LIMIT,
        fetchers: { eolFetch: fetch, nvdFetch: fetch },
      },
    );

    const now = new Date();
    await prisma.scheduledJob
      .update({
        where: { jobId: CATALOG_SWEEP_JOB_ID },
        data: {
          lastRunAt: now,
          lastStatus: result.failures > 0 ? "partial" : "ok",
          lastError: result.failures > 0 ? `${result.failures} identity failure(s)` : null,
          nextRunAt: computeNextRunAt(job.schedule, now),
        },
      })
      .catch(() => {});

    return { skipped: false, ...result };
  } catch (err: unknown) {
    const message = getErrorMessage(err);
    await prisma.scheduledJob
      .update({
        where: { jobId: CATALOG_SWEEP_JOB_ID },
        data: { lastRunAt: new Date(), lastStatus: "error", lastError: message },
      })
      .catch(() => {});
    return { skipped: true, reason: `error: ${message}` };
  }
}
