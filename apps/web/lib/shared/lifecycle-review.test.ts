import { describe, expect, it } from "vitest";

import {
  buildLifecycleReviewQueue,
  type LifecycleReviewCandidate,
} from "./lifecycle-review";

const asOf = new Date("2026-04-23T00:00:00.000Z");

describe("buildLifecycleReviewQueue", () => {
  it("groups reviewed items into reusable lifecycle queues", () => {
    const queue = buildLifecycleReviewQueue(
      [
        {
          id: "ci-1",
          name: "Core Firewall",
          ciType: "firewall",
          lifecycleStatus: "replace_due",
          supportStatus: "expired",
          recommendedAction: "replace",
          attentionLevel: "high",
          nextReviewAt: new Date("2026-04-24T00:00:00.000Z"),
        },
        {
          id: "ci-2",
          name: "Endpoint Security",
          ciType: "security_license",
          lifecycleStatus: "renew",
          supportStatus: "supported",
          recommendedAction: "renew",
          attentionLevel: "medium",
          licensingReviewRequired: true,
          nextReviewAt: new Date("2026-05-15T00:00:00.000Z"),
        },
        {
          id: "ci-3",
          name: "Ubuntu Server",
          ciType: "server",
          lifecycleStatus: "review",
          supportStatus: "approaching_end",
          recommendedAction: "upgrade",
          attentionLevel: "medium",
          nextReviewAt: new Date("2026-07-01T00:00:00.000Z"),
        },
        {
          id: "ci-4",
          name: "Legacy Integration",
          ciType: "application",
          lifecycleStatus: "unknown",
          supportStatus: "unknown",
          recommendedAction: "research",
          attentionLevel: "low",
          nextReviewAt: null,
        },
      ] satisfies LifecycleReviewCandidate[],
      asOf,
    );

    expect(queue.counts).toEqual({
      urgent: 1,
      renewal: 1,
      review: 1,
      research: 1,
    });
    expect(queue.queues.urgent[0]).toMatchObject({
      id: "ci-1",
      queue: "urgent",
    });
    expect(queue.queues.renewal[0]).toMatchObject({
      id: "ci-2",
      queue: "renewal",
    });
    expect(queue.queues.review[0]).toMatchObject({
      id: "ci-3",
      queue: "review",
    });
    expect(queue.queues.research[0]).toMatchObject({
      id: "ci-4",
      queue: "research",
    });
    expect(queue.nextUp?.id).toBe("ci-1");
  });
});
