import { describe, expect, it } from "vitest";

import { organizationDecisionInboxWhere } from "./organization-decision-inbox";

describe("organizationDecisionInboxWhere", () => {
  it("selects unanswered organization-profile decisions regardless of entry route", () => {
    const dbNull = { marker: "db-null" };
    expect(organizationDecisionInboxWhere("DPF-ORG", dbNull as never)).toEqual({
      outcomeType: { in: ["defer", "escalate"] },
      profileId: "DPF-ORG",
      buildId: null,
      taskRunId: null,
      question: { not: "" },
      humanOutcome: { equals: dbNull },
      NOT: [
        { gateKey: "profession" },
        { domainClass: "kernel-consult" },
        { routeContext: { startsWith: "mcp:principle_decide" } },
      ],
    });
  });

  it("fails closed when no organization profile exists", () => {
    expect(organizationDecisionInboxWhere(null, { marker: "db-null" } as never)).toEqual({
      profileId: "__missing_organization_profile__",
    });
  });
});
