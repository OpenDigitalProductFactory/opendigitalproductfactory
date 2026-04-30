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

  it("shows the selected agent's shared AIDoc authority snapshot when provided", () => {
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
        agentSnapshots={[
          {
            id: "1",
            agentId: "finance-controller",
            name: "Finance Controller",
            status: "active",
            lifecycleStage: "production",
            humanSupervisorId: "HR-400",
            linkedPrincipalId: "PRN-000010",
            gaid: "gaid:priv:dpf.internal:finance-controller",
            aidoc: null,
            authorizationClasses: ["observe", "approve"],
            operatingProfileFingerprint: "fp-fin-001",
            validationState: "validated",
            toolSurfaceCount: 1,
            promptClassRefCount: 2,
            memoryFactCurrentCount: 3,
            memoryFactPendingRevalidationCount: 1,
            memoryFactLegacyCount: 2,
          },
        ]}
      />,
    );

    expect(html).toContain("Authority snapshot");
    expect(html).toContain("gaid:priv:dpf.internal:finance-controller");
    expect(html).toContain("fp-fin-001");
    expect(html).toContain("observe");
    expect(html).toContain("approve");
    expect(html).toContain("Memory freshness");
    expect(html).toContain("3 current");
    expect(html).toContain("1 pending");
  });
});
