// BI-9D43CBEF: the one place the document store reaches the job engine. The
// rendition wakes (lib/documents/rendition-trigger.ts) send through here so
// Inngest stays inside lib/queue (platform-substrate measurement).
import { jobs } from "@/lib/jobs";
import type {
  DocumentRenditionBackfillRequestedEvent,
  DocumentRenditionRequestedEvent,
} from "@/lib/jobs";

export type DocumentRenditionEvent = DocumentRenditionRequestedEvent | DocumentRenditionBackfillRequestedEvent;

export async function sendDocumentRenditionEvent(event: DocumentRenditionEvent): Promise<void> {
  await jobs.send(event);
}
