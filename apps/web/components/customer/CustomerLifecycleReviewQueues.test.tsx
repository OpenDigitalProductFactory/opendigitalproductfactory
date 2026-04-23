import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { CustomerLifecycleReviewQueues } from "./CustomerLifecycleReviewQueues";

describe("CustomerLifecycleReviewQueues", () => {
  it("renders queue counts and grouped lifecycle worklists", () => {
    const html = renderToStaticMarkup(
      <CustomerLifecycleReviewQueues
        counts={{
          urgent: 1,
          renewal: 1,
          review: 1,
          research: 0,
        }}
        queues={{
          urgent: [
            {
              id: "ci-1",
              customerCiId: "CCI-1",
              name: "Core Firewall",
              ciType: "firewall",
              lifecycleStatus: "replace_due",
              supportStatus: "expired",
              recommendedAction: "replace",
              attentionLevel: "high",
              queue: "urgent",
            },
          ],
          renewal: [
            {
              id: "ci-2",
              customerCiId: "CCI-2",
              name: "Endpoint Security",
              ciType: "security_license",
              lifecycleStatus: "renew",
              supportStatus: "supported",
              recommendedAction: "renew",
              attentionLevel: "medium",
              queue: "renewal",
            },
          ],
          review: [
            {
              id: "ci-3",
              customerCiId: "CCI-3",
              name: "Ubuntu Server",
              ciType: "server",
              lifecycleStatus: "review",
              supportStatus: "approaching_end",
              recommendedAction: "upgrade",
              attentionLevel: "medium",
              queue: "review",
            },
          ],
          research: [],
        }}
      />,
    );

    expect(html).toContain("Lifecycle Review Queues");
    expect(html).toContain("Urgent");
    expect(html).toContain("Renewals");
    expect(html).toContain("Reviews");
    expect(html).toContain("Research");
    expect(html).toContain("Core Firewall");
    expect(html).toContain("Endpoint Security");
    expect(html).toContain("Ubuntu Server");
    expect(html).toContain("replace_due");
    expect(html).toContain("renew");
    expect(html).toContain("upgrade");
  });
});
