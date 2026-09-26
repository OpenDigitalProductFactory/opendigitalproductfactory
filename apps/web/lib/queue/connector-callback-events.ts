import { jobs } from "@/lib/jobs";

type PostmarkCallbackEventData =
  | { deliveryKey: string }
  | { terminalAudit: { eventKey: string; responseKind: string; errorCode: string } };

/** Queue-owned ingress keeps connector routes independent of the queue substrate. */
export function enqueuePostmarkCallback(data: PostmarkCallbackEventData) {
  return jobs.send({ name: "integrations/postmark-callback.received", data });
}
