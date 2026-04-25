import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { BindingDetailDrawer, prepareBindingPatchPayload } from "./BindingDetailDrawer";

describe("BindingDetailDrawer", () => {
  it("renders summary, subjects, coworker application, evidence, and save controls", () => {
    const html = renderToStaticMarkup(
      <BindingDetailDrawer
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

    expect(html).toContain("Summary");
    expect(html).toContain("Subjects");
    expect(html).toContain("Coworker application");
    expect(html).toContain("Evidence");
    expect(html).toContain("Save changes");
    expect(html).toContain("Finance workspace controller");
    expect(html).toContain("DEC-001");
  });

  it("surfaces the monotonicity guardrail for contextual grants", () => {
    const html = renderToStaticMarkup(
      <BindingDetailDrawer
        binding={{
          bindingId: "AB-000001",
          name: "Finance workspace controller",
          scopeType: "route",
          status: "active",
          resourceType: "route",
          resourceRef: "/finance",
          approvalMode: "proposal-required",
          sensitivityCeiling: null,
          appliedAgent: {
            agentId: "finance-controller",
            name: "Finance Controller",
            governanceProfile: null,
            toolGrants: [{ grantKey: "ledger_write" }],
          },
          subjects: [],
          grants: [],
        }}
        evidence={[]}
      />,
    );

    expect(html).toContain("can only narrow intrinsic coworker grants");
  });

  it("drops legacy invalid grants from the patch payload while preserving valid narrowing grants", () => {
    expect(
      prepareBindingPatchPayload({
        name: "Finance workspace controller",
        status: "active",
        approvalMode: "proposal-required",
        sensitivityCeiling: "",
        subjects: [{ subjectType: "platform-role", subjectRef: "HR-400", relation: "allowed" }],
        grants: [
          { grantKey: "ledger_write", mode: "require-approval", rationale: "" },
          { grantKey: "backlog_read", mode: "deny", rationale: "Route should stay read-only" },
        ],
        intrinsicGrantKeys: ["backlog_read", "registry_read"],
      }),
    ).toMatchObject({
      name: "Finance workspace controller",
      grants: [{ grantKey: "backlog_read", mode: "deny", rationale: "Route should stay read-only" }],
    });
  });
});
