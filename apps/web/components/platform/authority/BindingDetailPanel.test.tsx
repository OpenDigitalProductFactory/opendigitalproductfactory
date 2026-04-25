import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { BindingDetailPanel } from "./BindingDetailPanel";

describe("BindingDetailPanel", () => {
  it("renders summary, subjects, grants, and evidence", () => {
    const html = renderToStaticMarkup(
      <BindingDetailPanel
        binding={{
          bindingId: "AB-000001",
          name: "Finance workspace controller",
          scopeType: "route",
          status: "active",
          resourceType: "route",
          resourceRef: "/finance",
          approvalMode: "proposal-required",
          sensitivityCeiling: "confidential",
          appliedAgent: {
            agentId: "finance-controller",
            name: "Finance Controller",
            governanceProfile: null,
            toolGrants: [{ grantKey: "ledger_write" }],
          },
          subjects: [
            { id: "subj-1", subjectType: "platform-role", subjectRef: "HR-400", relation: "allowed" },
          ],
          grants: [{ id: "grant-1", grantKey: "ledger_write", mode: "require-approval", rationale: "Needs review" }],
        }}
        evidence={[
          {
            id: "log-1",
            decisionId: "DEC-001",
            decision: "require-approval",
            actionKey: "ledger_write",
            routeContext: "/finance",
            createdAt: new Date("2026-04-24T18:00:00Z"),
          },
        ]}
      />,
    );

    expect(html).toContain("Finance workspace controller");
    expect(html).toContain("Summary");
    expect(html).toContain("HR-400");
    expect(html).toContain("ledger_write");
    expect(html).toContain("DEC-001");
  });
});
