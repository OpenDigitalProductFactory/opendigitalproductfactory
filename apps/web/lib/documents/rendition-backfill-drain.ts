// Drain the rendition backfill in bounded passes (BI-153EC72C).
//
// One backfill request walks every pending version once: each pass converts at
// most MAX_BACKFILL_LIMIT versions and hands back the cursor the next pass
// continues from (backfillDocumentRenditions). The job runs each pass as its
// own durable step (queue/functions/document-renditions.ts), so a restart
// resumes after the last finished pass. The pass bound caps one request; a
// queue deeper than that is picked up by the next request.

export const MAX_BACKFILL_PASSES = 50;

export type BackfillPassResult = { processed: number; nextCursor: string | null };

export async function drainRenditionBackfill(input: {
  runPass: (pass: number, cursor: string | null) => Promise<BackfillPassResult>;
  maxPasses?: number;
}): Promise<{ passes: number; processed: number; drained: boolean }> {
  const maxPasses = input.maxPasses ?? MAX_BACKFILL_PASSES;
  let cursor: string | null = null;
  let processed = 0;
  for (let pass = 1; pass <= maxPasses; pass++) {
    const result = await input.runPass(pass, cursor);
    processed += result.processed;
    if (!result.nextCursor) return { passes: pass, processed, drained: true };
    cursor = result.nextCursor;
  }
  return { passes: maxPasses, processed, drained: false };
}
