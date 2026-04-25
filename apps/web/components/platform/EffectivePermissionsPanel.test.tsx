import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { EffectivePermissionsPanel } from "./EffectivePermissionsPanel";

describe("EffectivePermissionsPanel", () => {
  it("shows route-aware binding context and a deep link when bindings are provided", () => {
    const html = renderToStaticMarkup(
      <EffectivePermissionsPanel
        agents={[
          {
            agentId: "finance-controller",
            agentName: "Finance Controller",
            grants: ["ledger_write"],
          },
        ]}
        roles={[
          {
            roleId: "HR-400",
            roleName: "ITFM Director",
          },
        ]}
        tools={[
          {
            toolName: "ledger_write",
            description: "Post a ledger adjustment",
            requiredCapability: "manage_finance",
            sideEffect: true,
          },
        ]}
        permissions={{
          manage_finance: ["HR-400"],
        }}
        bindings={[
          {
            bindingId: "AB-000001",
            resourceRef: "/finance",
            appliedAgentId: "finance-controller",
            approvalMode: "proposal-required",
            subjects: [{ subjectType: "platform-role", subjectRef: "HR-400", relation: "allowed" }],
            grants: [{ grantKey: "ledger_write", mode: "require-approval", rationale: "Needs review" }],
          },
        ]}
      />,
    );

    expect(html).toContain("Route Context");
    expect(html).toContain("/finance");
    expect(html).toContain("AB-000001");
    expect(html).toContain("Open binding");
  });
});
