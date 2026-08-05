import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { defaultVisibleHtml } from "@/lib/ux-budget/scope";
import { visibleText } from "@/lib/owner-first/ux-audit";
import { maxChoicesPerControl } from "@/lib/ux-budget/measure";
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

  it("applies the release-plan grant contract to quiescence status", () => {
    const html = renderToStaticMarkup(
      <EffectivePermissionsPanel
        agents={[{ agentId: "observer", agentName: "Observer", grants: [] }]}
        roles={[{ roleId: "HR-000", roleName: "CDIO" }]}
        tools={[
          {
            toolName: "get_quiescence_status",
            description: "Read quiescence status",
            requiredCapability: null,
            sideEffect: false,
          },
        ]}
        permissions={{}}
      />,
    );

    expect(html).toContain("0 of 1 tools available");
  });

  // --- Cognitive-load contract (BI-D6135B88) -------------------------------
  //
  // This surface measured 3,451 words visible on arrival against a 450-word
  // detail budget, and offered a 94-option agent <select> against a budget of
  // 20. These assertions pin the shape that fixed it, so a future change that
  // re-floods the first viewport fails here rather than in the nightly sweep.

  const MANY_TOOLS = Array.from({ length: 40 }, (_, index) => ({
    toolName: `tool_number_${index}`,
    description: `Description for tool ${index}`,
    requiredCapability: null,
    sideEffect: false,
  }));
  const MANY_AGENTS = Array.from({ length: 94 }, (_, index) => ({
    agentId: `AGT-${index}`,
    agentName: `Agent ${index}`,
    grants: [],
  }));

  function renderWide() {
    return renderToStaticMarkup(
      <EffectivePermissionsPanel
        agents={MANY_AGENTS}
        roles={[{ roleId: "HR-000", roleName: "CDIO" }]}
        tools={MANY_TOOLS}
        permissions={{}}
        products={[
          {
            productId: "prod-1",
            productName: "Ledger",
            roles: [
              {
                roleName: "Controller",
                authorityDomain: "finance",
                hitlTierDefault: 2,
                escalatesTo: "HR-400",
                assignee: null,
              },
            ],
          },
        ]}
      />,
    );
  }

  it("defers the tool inventory out of the arrival scope but keeps its count on screen", () => {
    const html = renderWide();
    const visible = visibleText(defaultVisibleHtml(html));

    // The count and the way in are both visible — deferral, not truncation.
    expect(html).toContain("Browse all 40 tools");
    expect(visible).toContain("Browse all 40 tools");
    expect(visible).toContain("40 of 40 tools available");

    // ...but the 40 rows themselves are not part of what the reader meets.
    expect(html).toContain("tool_number_39");
    expect(visible).not.toContain("tool_number_39");
  });

  it("resolves the agent choice with a searchable control instead of a 94-option select", () => {
    const html = renderWide();

    expect(maxChoicesPerControl(defaultVisibleHtml(html))).toBe(0);
    expect(html).not.toContain("<select");
    // Every agent is still offered, via the datalist the combobox reads.
    expect(html).toContain("AGT-93 - Agent 93");
    expect(html).toContain("94 available");
  });

  it("keeps route and product refinements out of the first viewport", () => {
    const visible = visibleText(defaultVisibleHtml(renderWide()));

    expect(visible).toContain("Refine by route or product");
    expect(visible).not.toContain("Product (BMR)");
  });

  it("does not open a product's BMR authority table until a product is chosen", () => {
    const html = renderWide();

    // Previously the first product was auto-selected, so its whole role table
    // rendered on arrival for a product nobody had asked about.
    expect(html).not.toContain("BMR Authority Domains");
  });
});
