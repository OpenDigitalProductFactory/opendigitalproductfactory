import { jobs } from "@/lib/jobs";
import { gateAtEntry } from "../quiescence-gates";

// BI-9D43CBEF (S4 of BI-815D40C6): the durable rendition job.
//
// A saved office version gets PDF and plain-text renditions through the
// dpf-doctools engine, and its text is indexed for full-text and semantic
// search (lib/documents/renditions.ts). Both functions are event-triggered, so
// they run on every install regardless of the scheduled-functions flag; the
// wakes come from lib/documents/rendition-trigger.ts.
//
// Concurrency 2 matches convertDocument's per-process cap, so a burst of saves
// queues here instead of piling up behind the converter's semaphore. The work
// is idempotent on (documentVersionId, renditionKind): a retry or a duplicate
// event only fills in what is still missing.

export const documentRenditionGenerate = jobs.createFunction(
  {
    id: "documents/rendition-generate",
    retries: 2,
    concurrency: { limit: 2, scope: "fn" },
    triggers: [{ event: "documents/rendition.requested" }],
  },
  async ({ event, step }) => {
    const gate = await gateAtEntry(step, "documents/rendition-generate");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("generate-renditions", async () => {
      const { generateDocumentRenditions } = await import("@/lib/documents/renditions");
      return generateDocumentRenditions(String(event.data.documentVersionId ?? ""));
    });
  },
);

export const documentRenditionBackfill = jobs.createFunction(
  {
    id: "documents/rendition-backfill",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [{ event: "documents/rendition.backfill-requested" }],
  },
  async ({ event, step }) => {
    const gate = await gateAtEntry(step, "documents/rendition-backfill");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("backfill-renditions", async () => {
      const { backfillDocumentRenditions } = await import("@/lib/documents/renditions");
      const limit = typeof event.data.limit === "number" ? event.data.limit : undefined;
      return backfillDocumentRenditions({ limit });
    });
  },
);
