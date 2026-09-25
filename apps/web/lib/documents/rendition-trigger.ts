// When the rendition job runs (BI-9D43CBEF).
//
// Two wakes, both advisory: the durable job (queue/functions/
// document-renditions.ts) is idempotent, so a lost or duplicate event costs
// nothing but a delay.
//   - A version save asks for that version's renditions.
//   - The converter becoming available asks for a bounded backfill. A converter
//     that is off is retried on the next availability flip, not per minute:
//     the flip is observed by the doctools dependency probe, which the metrics
//     scrape already runs, so no new schedule is added. The first available
//     answer after a restart counts as a flip, which also sweeps anything saved
//     while the portal was down.

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
