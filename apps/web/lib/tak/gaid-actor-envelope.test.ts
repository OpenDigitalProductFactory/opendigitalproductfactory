import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    principalAlias: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import { resolveGaidActorEnvelope } from "./gaid-actor-envelope";

const baseArgs = {
  toolName: "create_digital_product",
  rawParams: { name: "Self-host support subscription" },
  userId: "user-1",
  userContext: { platformRole: "ceo", isSuperuser: true },
  source: "rest" as const,
};

describe("resolveGaidActorEnvelope", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps a direct human action Principal-bound without inventing an agent GAID", async () => {
    vi.mocked(prisma.principalAlias.findFirst).mockResolvedValue({
      principal: {
        principalId: "PRN-HUMAN",
        aliases: [],
      },
    } as never);

    await expect(resolveGaidActorEnvelope(baseArgs as never)).resolves.toEqual({
      principalId: "PRN-HUMAN",
      gaid: null,
      actorKind: "owner",
      actorRef: "user-1",
    });
  });

  it("still fails closed when a coworker has no GAID identity", async () => {
    vi.mocked(prisma.principalAlias.findFirst).mockResolvedValue({
      principal: {
        principalId: "PRN-COWORKER",
        aliases: [],
      },
    } as never);

    await expect(resolveGaidActorEnvelope({
      ...baseArgs,
      context: { agentId: "AGT-100" },
      source: "agentic-loop",
    } as never)).resolves.toBeNull();
  });

  it("binds a coworker action to its registered GAID", async () => {
    vi.mocked(prisma.principalAlias.findFirst).mockResolvedValue({
      principal: {
        principalId: "PRN-COWORKER",
        aliases: [{ aliasType: "gaid", aliasValue: "gaid:priv:dpf.internal:agt-100" }],
      },
    } as never);

    await expect(resolveGaidActorEnvelope({
      ...baseArgs,
      context: { agentId: "AGT-100" },
      source: "agentic-loop",
    } as never)).resolves.toEqual({
      principalId: "PRN-COWORKER",
      gaid: "gaid:priv:dpf.internal:agt-100",
      actorKind: "coworker",
      actorRef: "AGT-100",
    });
  });
});
