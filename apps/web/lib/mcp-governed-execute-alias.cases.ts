import { expect, it } from "vitest";
import {
  buildCoworkerApprovalBinding,
  type CoworkerAuthorityInput,
} from "./govern/authority/coworker-authority-decision";
import type { ToolResult } from "./mcp-tool-types";
import type { RoomParticipantInvitationPreflight } from "./work-management/room-participant-invitation-preflight.server";
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
  setOAuthRefusalResults(results: Array<ToolResult | null>): void;
  oauthRefusalCalls(): unknown[][];
  setInvitationPreflightResult(result: RoomParticipantInvitationPreflight): void;
  invitationPreflightCalls(): unknown[][];
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

  it.each(["external-jsonrpc", "internal-mcp-session"] as const)(
    "runs the real invitation preflight dispatcher for %s calls",
    async (source) => {
      evidence.setInvitationPreflightResult({
        verdict: "deny",
        result: {
          success: false,
          error: "room_not_admitted",
          message: "The room owner must admit this coworker.",
        },
      });
      evidence.applyOverrides({
        toolPreflight: null,
        resolveCoworkerAuthorityInput: async () => evidence.authorityInput({
          action: {
            ...evidence.authorityInput().action,
            toolName: "invite_room_participant",
            requiredCapability: "view_operations",
            sideEffect: true,
            approvalPolicy: "none",
          },
        }),
      });

      const result = await governedExecuteTool({
        toolName: "invite_room_participant",
        rawParams: { caseKey: "backlog-item:BI-1", agentId: "AGT-100" },
        userId: "user-1",
        userContext: evidence.normalUser,
        context: {
          agentId: "AGT-100",
          ...(source === "external-jsonrpc" ? { authSource: "oauth" } : {}),
        },
        source,
      });

      expect(result).toMatchObject({ success: false, error: "room_not_admitted" });
      expect(evidence.invitationPreflightCalls()).toHaveLength(1);
      expect(evidence.executeMock()).not.toHaveBeenCalled();
    },
  );

  it("runs deterministic invitation preconditions before grant-based authority escalation", async () => {
    evidence.setInvitationPreflightResult({
      verdict: "deny",
      result: {
        success: false,
        error: "room_not_admitted",
        message: "The room owner must admit this coworker.",
      },
    });
    evidence.applyOverrides({
      toolPreflight: null,
      isAllowedByGrants: () => false,
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
    });

    const result = await governedExecuteTool({
      toolName: "invite_room_participant",
      rawParams: { caseKey: "backlog-item:BI-1", agentId: "AGT-100" },
      userId: "user-1",
      userContext: evidence.normalUser,
      context: { agentId: "AGT-100", authSource: "oauth" },
      source: "external-jsonrpc",
    });

    expect(result).toMatchObject({ success: false, error: "room_not_admitted" });
    expect(evidence.approvalEnvelopeCreate()).not.toHaveBeenCalled();
    expect(evidence.executeMock()).not.toHaveBeenCalled();
  });

  it("keeps the execution-time OAuth room check for targets without capsuleId", async () => {
    evidence.setOAuthRefusalResults([{
      success: false,
      error: "workroom_access_denied",
      message: "Room access changed before execution.",
    }]);

    const result = await governedExecuteTool({
      toolName: "query_backlog",
      rawParams: { caseKey: "work-capsule:WC-1" },
      userId: "user-1",
      userContext: evidence.normalUser,
      context: { authSource: "oauth" },
      source: "external-jsonrpc",
    });

    expect(result).toMatchObject({ success: false, error: "workroom_access_denied" });
    expect(evidence.oauthRefusalCalls()).toEqual([
      [expect.objectContaining({
        params: { caseKey: "work-capsule:WC-1" },
        authSource: "oauth",
      })],
    ]);
    expect(evidence.executeMock()).not.toHaveBeenCalled();
  });

  it("rechecks OAuth room access when an approved call resumes", async () => {
    const pending = evidence.authorityInput({
      action: {
        ...evidence.authorityInput().action,
        toolName: "create_backlog_item",
        requiredCapability: "manage_backlog",
        sideEffect: true,
        approvalPolicy: "side-effects",
      },
      task: { taskRunId: "TASK-1", parentTaskRunId: "TASK-PARENT" },
      rawParams: { title: "approved title" },
    });
    const binding = buildCoworkerApprovalBinding(pending);
    evidence.setOAuthRefusalResults([null, {
      success: false,
      error: "workroom_access_denied",
      message: "Room access changed before execution.",
    }]);
    evidence.applyOverrides({
      toolPreflight: null,
      resolveCoworkerAuthorityInput: async () => ({
        ...pending,
        approval: {
          envelopeId: "ENV-APPROVED",
          status: "approved",
          expiresAt: new Date(Date.now() + 60_000),
          binding,
        },
      }),
    });

    const result = await governedExecuteTool({
      toolName: "create_backlog_item",
      rawParams: { title: "approved title" },
      userId: "user-1",
      userContext: evidence.normalUser,
      context: {
        agentId: "AGT-100",
        authSource: "oauth",
        taskRunId: "TASK-1",
      },
      source: "external-jsonrpc",
    });

    expect(result).toMatchObject({ success: false, error: "workroom_access_denied" });
    expect(evidence.oauthRefusalCalls()).toHaveLength(2);
    expect(evidence.executeMock()).not.toHaveBeenCalled();
  });

  it.each(["create_workroom", "create_work_capsule"])("preserves capability denial for %s", async (toolName) => {
    const result = await governedExecuteTool({
      toolName, rawParams: {}, userId: "u",
      userContext: { platformRole: "viewer", isSuperuser: false }, source: "rest",
    });
    expect(result.error).toBe("forbidden_capability");
    expect(evidence.executionCalls()).toHaveLength(0);
    expect(evidence.auditRows().at(-1)).toMatchObject({ success: false });
  });
  it("returns unknown_tool without execution or audit", async () => {
    const result = await governedExecuteTool({
      toolName: "totally_made_up_tool", rawParams: {}, userId: "u",
      userContext: evidence.normalUser, source: "rest",
    });
    expect(result).toMatchObject({ success: false, error: "unknown_tool" });
    expect(evidence.executionCalls()).toHaveLength(0);
    expect(evidence.auditRows()).toHaveLength(0);
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
