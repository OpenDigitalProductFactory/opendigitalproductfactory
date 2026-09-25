// BI-9D43CBEF: the one place the document store reaches the job engine. The
// rendition wakes (lib/documents/rendition-trigger.ts) send through here so
// Inngest stays inside lib/queue (platform-substrate measurement).
import { inngest } from "./inngest-client";
import type {
  DocumentRenditionBackfillRequestedEvent,
  DocumentRenditionRequestedEvent,
} from "./inngest-client";

export type DocumentRenditionEvent = DocumentRenditionRequestedEvent | DocumentRenditionBackfillRequestedEvent;

export async function sendDocumentRenditionEvent(event: DocumentRenditionEvent): Promise<void> {
  await inngest.send(event);
}
