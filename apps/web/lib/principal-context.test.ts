import { describe, expect, it } from "vitest";
import { buildPrincipalContext } from "./principal-context";

describe("buildPrincipalContext", () => {
  it("builds human-only context from a session user", () => {
    const ctx = buildPrincipalContext({
      sessionUser: {
        id: "usr_1",
        email: "manager@example.com",
        platformRole: "HR-100",
        isSuperuser: false,
      },
      teamIds: ["team_ops"],
      actingAgentId: null,
      delegationGrantIds: [],
    });

    expect(ctx.authenticatedSubject).toEqual({ kind: "user", userId: "usr_1" });
    expect(ctx.actingHuman).toEqual({ kind: "user", userId: "usr_1" });
    expect(ctx.platformRoleIds).toEqual(["HR-100"]);
    expect(ctx.teamIds).toEqual(["team_ops"]);
    expect(ctx.actingAgent).toBeUndefined();
  });

  it("adds acting agent and delegation grants when present", () => {
    const ctx = buildPrincipalContext({
      sessionUser: {
        id: "usr_1",
        email: "manager@example.com",
        platformRole: "HR-100",
        isSuperuser: false,
      },
      teamIds: ["team_ops"],
      actingAgentId: "AGT-100",
      delegationGrantIds: ["DGR-001"],
    });

    expect(ctx.actingAgent?.agentId).toBe("AGT-100");
    expect(ctx.delegationGrantIds).toEqual(["DGR-001"]);
  });
});
