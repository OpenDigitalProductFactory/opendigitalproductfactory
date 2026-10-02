import { expect, it } from "vitest";
import type { CoworkerAuthorityInput } from "./govern/authority/coworker-authority-decision";
import { governedExecuteTool, type _setGovernanceForTests } from "./mcp-governed-execute";

export function registerWorkroomAliasCases(evidence: {
  executionCalls: () => unknown[][];
  auditRows: () => Record<string, unknown>[];
  applyOverrides(overrides: Parameters<typeof _setGovernanceForTests>[0]): void;
  authorityInput(overrides?: Partial<CoworkerAuthorityInput>): CoworkerAuthorityInput;
  normalUser: { platformRole: string; isSuperuser: boolean };
  executeMock(): unknown;
  approvalEnvelopeCreate(): unknown;
  authorityRows(): Record<string, unknown>[];
}): void {
  it("returns an impossible room invite before creating an authority approval", async () => {
    evidence.applyOverrides({
      resolveCoworkerAuthorityInput: async () => evidence.authorityInput({
        action: {
          ...evidence.authorityInput().action,
          toolName: "invite_room_participant",
          requiredCapability: "view_operations",
          sideEffect: true,
          approvalPolicy: "all",
          consequence: "authority",
        },
      }),
      toolPreflight: async () => ({
        success: false,
        error: "room_not_admitted",
        message: "This coworker cannot invite itself; use the owner's Participants control.",
        data: { recovery: { control: "room-participants", caseKey: "backlog-item:BI-1" } },
      }),
    });
    const result = await governedExecuteTool({
      toolName: "invite_room_participant",
      rawParams: { caseKey: "backlog-item:BI-1", agentId: "AGT-100" },
      userId: "user-1",
      userContext: evidence.normalUser,
      context: { agentId: "AGT-100", authSource: "oauth" },
      source: "external-jsonrpc",
    });
    expect(result).toMatchObject({
      success: false,
      error: "room_not_admitted",
      governance: { rejected: "precondition_denied" },
      data: { recovery: { control: "room-participants" } },
    });
    expect(evidence.executeMock()).not.toHaveBeenCalled();
    expect(evidence.approvalEnvelopeCreate()).not.toHaveBeenCalled();
    expect(evidence.authorityRows()).toHaveLength(0);
    expect(evidence.auditRows().at(-1)).toMatchObject({
      toolName: "invite_room_participant", success: false,
    });
  });

  it.each(["create_workroom", "create_work_capsule"])("preserves capability denial for %s", async (toolName) => {
    const result = await governedExecuteTool({
      toolName, rawParams: {}, userId: "u",
      userContext: { platformRole: "viewer", isSuperuser: false }, source: "rest",
    });
    expect(result.error).toBe("forbidden_capability");
    expect(evidence.executionCalls()).toHaveLength(0);
  });
  it("resolves a held Workroom alias before governance and dispatch", async () => {
    const result = await governedExecuteTool({
      toolName: "list_work_capsules", rawParams: { limit: 5 }, userId: "u",
      userContext: { platformRole: "ceo", isSuperuser: true }, source: "external-jsonrpc",
    });
    expect(result.success).toBe(true);
    expect(evidence.executionCalls()[0]?.[0]).toBe("list_workrooms");
    expect(evidence.auditRows()[0]?.toolName).toBe("list_workrooms");
  });
}
