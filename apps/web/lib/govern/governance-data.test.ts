import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    authorizationDecisionLog: {
      create: vi.fn(),
    },
    principalAlias: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import { createAuthorizationDecisionLog } from "./governance-data";

describe("createAuthorizationDecisionLog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores the agent context as the resolved GAID when available", async () => {
    vi.mocked(prisma.principalAlias.findMany)
      .mockResolvedValueOnce([
        {
          principalId: "principal-1",
          aliasValue: "hr-specialist",
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          principalId: "principal-1",
          aliasValue: "gaid:priv:dpf.internal:hr-specialist",
        },
      ] as never);

    await createAuthorizationDecisionLog({
      actorType: "user",
      actorRef: "user-1",
      humanContextRef: "user-1",
      agentContextRef: "hr-specialist",
      actionKey: "delegation_grant.create",
      decision: "allow",
      rationale: { code: "ok" },
    });

    expect(prisma.authorizationDecisionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorRef: "user-1",
          agentContextRef: "gaid:priv:dpf.internal:hr-specialist",
        }),
      }),
    );
  });
});
