// Catalog enrichment sweep runner (EP-ASSET-INTELLIGENCE, spec §4.2/§4.4).
//
// Wires the pure @dpf/db sweep logic to the real prisma client + global fetch, and
// maintains the ScheduledJob bookkeeping row (lastRunAt / lastStatus / nextRunAt)
// that the admin Scheduled Jobs surface renders. Honors the per-job enabled kill
// switch (ScheduledJob.enabled=false) like the other governed sweeps.

import { gunzipSync } from "node:zlib";
import type { CatalogSweepResult } from "@dpf/db";
import type { InventoryLifecycleProjectionResult } from "@/lib/lifecycle/inventory-projector";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { isJobEnabled } from "@/lib/operate/scheduled-jobs/core";
import {
  CATALOG_SWEEP_JOB_ID,
  CATALOG_SWEEP_JOB_NAME,
  CATALOG_SWEEP_BATCH_LIMIT,
} from "./catalog-sweep-constants";

// LVFS/fwupd firmware catalog (HAM Phase D1, BI-84710E60). The @dpf/db sweep is pure and
// takes decompressed AppStream XML, so the transport (fetch + gunzip) lives here. LVFS
// serves a gzipped file (Content-Type application/gzip, not Content-Encoding), so we gunzip
// explicitly. Air-gapped installs can point LVFS_CATALOG_URL at a mirror. Returns null on
// any error — the sweep degrades to no firmware hints rather than failing.
const LVFS_CATALOG_URL =
  process.env.LVFS_CATALOG_URL ?? "https://cdn.fwupd.org/downloads/firmware.xml.gz";

async function fetchLvfsCatalog(): Promise<string | null> {
  try {
    const res = await fetch(LVFS_CATALOG_URL);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // Gzip magic bytes 1f 8b — gunzip; otherwise assume already-plain XML (e.g. a mirror).
    const xml = buf.length > 1 && buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
    return xml;
  } catch {
    return null;
  }
}

export type CatalogSweepRunOutcome =
  | ({ skipped: false; lifecycleProjection: InventoryLifecycleProjectionResult } & CatalogSweepResult)
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
    select: { schedule: true },
  });

  // Operator kill switch — the one shared implementation (BI-7E49FA15). Kept
  // here as well as in gateAtEntry because the run-now event path reaches this
  // runner without passing through the cron entry gate.
  if (!(await isJobEnabled(CATALOG_SWEEP_JOB_ID))) {
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
        fetchers: { eolFetch: fetch, nvdFetch: fetch, wikidataFetch: fetch, lvfsFetch: fetchLvfsCatalog },
      },
    );
    const { projectInventoryLifecycle } = await import("@/lib/lifecycle/inventory-projector");
    const lifecycleProjection = await projectInventoryLifecycle(
      prisma as unknown as Parameters<typeof projectInventoryLifecycle>[0],
      {
        limit: options.limit ?? CATALOG_SWEEP_BATCH_LIMIT,
        upstreamEvidenceComplete: result.failures === 0,
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

    return { skipped: false, ...result, lifecycleProjection };
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
