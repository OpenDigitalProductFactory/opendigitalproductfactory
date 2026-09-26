// When the rendition job runs (BI-9D43CBEF).
//
// The wakes are advisory: the durable job (queue/functions/
// document-renditions.ts) is idempotent, so a lost or duplicate event costs
// nothing but a delay.
//   - A version save asks for that version's renditions.
//   - Portal start and a release change ask for a backfill directly, debounced
//     (document-engine-boot.ts, BI-153EC72C). This is the wake every install
//     gets: it also sweeps anything saved while the portal was down, or before
//     the upgrade that brought the converter.
//   - The converter becoming available asks for a backfill too. The flip is
//     observed by the doctools dependency probe inside the /api/metrics scrape,
//     so it fires only where something scrapes (the optional observability
//     profile); it is a faster path there, not the guarantee.

import { probeDoctools } from "./conversion/availability";

export const RENDITION_REQUESTED_EVENT = "documents/rendition.requested";
export const RENDITION_BACKFILL_EVENT = "documents/rendition.backfill-requested";

type RenditionEvent =
  | { name: typeof RENDITION_REQUESTED_EVENT; data: { documentVersionId: string } }
  | { name: typeof RENDITION_BACKFILL_EVENT; data: { reason: string; limit?: number } };

type Send = (event: RenditionEvent) => Promise<unknown>;

const defaultSend: Send = async (event) => {
  const { sendDocumentRenditionEvent } = await import("@/lib/queue/document-rendition-events");
  return sendDocumentRenditionEvent(event);
};

/** Ask for a version's renditions. Best effort: never fails the save. */
export async function requestDocumentRenditions(documentVersionId: string, deps: { send?: Send } = {}): Promise<boolean> {
  try {
    await (deps.send ?? defaultSend)({ name: RENDITION_REQUESTED_EVENT, data: { documentVersionId } });
    return true;
  } catch (err) {
    console.warn("[renditions] could not request renditions; a later backfill sweep picks the version up:", err);
    return false;
  }
}

/**
 * Wrap the doctools dependency probe so that an unavailable-or-unknown to
 * available transition requests one backfill. Returns the probe's answer
 * unchanged, for the dpf_dependency_up gauge.
 */
export function createRenditionResumeWatch(deps: {
  probe: () => Promise<boolean | null>;
  send?: Send;
}): () => Promise<boolean | null> {
  let wasAvailable = false;
  return async () => {
    const up = await deps.probe();
    const available = up === true;
    if (available && !wasAvailable) {
      try {
        await (deps.send ?? defaultSend)({ name: RENDITION_BACKFILL_EVENT, data: { reason: "converter-available" } });
      } catch (err) {
        console.warn("[renditions] could not request the rendition backfill:", err);
      }
    }
    wasAvailable = available;
    return up;
  };
}

/** The doctools dependency probe, resuming renditions when the converter comes back. */
export const probeDoctoolsAndResumeRenditions = createRenditionResumeWatch({ probe: probeDoctools });

/** How long portal-start and release-change asks wait for one another (BI-153EC72C). */
export const BACKFILL_REQUEST_DEBOUNCE_MS = 60_000;

/**
 * A debounced backfill request: asks inside one window send a single event
 * whose reason names each distinct ask. Never throws.
 */
export function createDebouncedBackfillRequest(deps: {
  send?: Send;
  delayMs?: number;
}): (reason: string) => void {
  const delayMs = deps.delayMs ?? BACKFILL_REQUEST_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reasons: string[] = [];
  const flush = async () => {
    timer = undefined;
    const reason = reasons.join("+");
    reasons = [];
    try {
      await (deps.send ?? defaultSend)({ name: RENDITION_BACKFILL_EVENT, data: { reason } });
      console.log(`[renditions] backfill requested (${reason})`);
    } catch (err) {
      console.warn("[renditions] could not request the rendition backfill:", err);
    }
  };
  return (reason) => {
    if (!reasons.includes(reason)) reasons.push(reason);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), delayMs);
    (timer as { unref?: () => void }).unref?.();
  };
}
